/**
 * Verifies Today's "waiting since" against real rows (2026-09-28).
 *
 *   npm run preview:verify -- scripts/verify-today-data.ts
 *
 * When a deal entered its stage ignores undone moves and undo rows; rows come
 * out oldest-waiting first with their shipped / delivered lines and the Late
 * badge; a deal gone quiet at Talking comes back to Follow up. Throwaway
 * __verify_ rows, cleaned up in finally.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";
import { changeStage } from "../src/lib/mutations";
import { getStageSince } from "../src/lib/queries";
import { getTodayData } from "../src/lib/today-data";
import { DEFAULT_THRESHOLDS } from "../src/lib/thresholds";
import { setSnooze } from "../src/lib/snooze";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function main() {
  const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.slug, "hella")).limit(1);
  let campaignId = "00000000-0000-0000-0000-000000000000";
  const creatorIds: string[] = [];
  const add = async (h: string) => {
    const r = await createCreatorWithPartnership({ clientId: client.id, name: h, links: [`https://www.instagram.com/${h}`], campaignId });
    creatorIds.push(r.creatorId);
    return r.partnershipId;
  };
  const transitionsOf = (id: string) => db.select().from(schema.cmStageTransitions).where(eq(schema.cmStageTransitions.partnershipId, id));
  try {
    campaignId = await ensureCampaignByName(client.id, "__verify_today_data__");

    console.log("\n── When a deal entered its stage ──");
    const p = await add("__verify_td_stage");
    await changeStage(p, "in_conversation");
    const [intoTalking] = (await transitionsOf(p)).filter((t) => t.toStage === "in_conversation");
    await db.update(schema.cmStageTransitions).set({ changedAt: daysAgo(6) }).where(eq(schema.cmStageTransitions.id, intoTalking.id));
    const start = (await getStageSince([p])).get(p);
    check("the move into the current stage is the start", !!start && Math.abs(start.getTime() - daysAgo(6).getTime()) < 5_000, start?.toISOString());
    // Moved on to Agreed, then that move was undone: back at Talking. The undo row is newer, but the stay began at the real move.
    await changeStage(p, "awaiting_address");
    const [intoAgreed] = (await transitionsOf(p)).filter((t) => t.toStage === "awaiting_address");
    await db.update(schema.cmStageTransitions).set({ undoneAt: new Date() }).where(eq(schema.cmStageTransitions.id, intoAgreed.id));
    await db.insert(schema.cmStageTransitions).values({ partnershipId: p, fromStage: "awaiting_address", toStage: "in_conversation", source: "manual", reason: "undo", changedAt: daysAgo(1) });
    await db.update(schema.cmPartnerships).set({ stage: "in_conversation" }).where(eq(schema.cmPartnerships.id, p));
    const since = (await getStageSince([p])).get(p);
    check("an undone move and the undo row itself don't restart the clock", !!since && Math.abs(since.getTime() - daysAgo(6).getTime()) < 5_000, since?.toISOString());
    const fresh = await add("__verify_td_fresh");
    check("a deal still at its first stage starts when it was added", Math.abs(((await getStageSince([fresh])).get(fresh)?.getTime() ?? 0) - Date.now()) < 60_000);

    console.log("\n── Today's order and lines ──");
    const late = await add("__verify_td_late");
    const recent = await add("__verify_td_recent");
    for (const [id, deliveredDaysAgo] of [
      [late, DEFAULT_THRESHOLDS.videoDueAfterDays + 6],
      [recent, 5],
    ] as const) {
      await changeStage(id, "content_pending");
      await db.update(schema.cmShipments).set({ status: "delivered", deliveredAt: daysAgo(deliveredDaysAgo) }).where(eq(schema.cmShipments.partnershipId, id));
    }
    const quiet = await add("__verify_td_quiet");
    await changeStage(quiet, "in_conversation");
    // At Talking since before our last DM (a stage move since would restart the quiet clock — verify-today).
    await db
      .update(schema.cmStageTransitions)
      .set({ changedAt: daysAgo(DEFAULT_THRESHOLDS.nudgeAfterDays + 4) })
      .where(and(eq(schema.cmStageTransitions.partnershipId, quiet), eq(schema.cmStageTransitions.toStage, "in_conversation")));
    await db.insert(schema.cmOutreachEvents).values({ partnershipId: quiet, direction: "outbound", channel: "ig_dm", kind: "follow_up", occurredAt: daysAgo(DEFAULT_THRESHOLDS.nudgeAfterDays + 2) });
    // …and one moved to Talking this morning after a DM just as old is not quiet: someone just acted on it.
    const fresh2 = await add("__verify_td_fresh_move");
    await changeStage(fresh2, "in_conversation");
    await db.insert(schema.cmOutreachEvents).values({ partnershipId: fresh2, direction: "outbound", channel: "ig_dm", kind: "follow_up", occurredAt: daysAgo(DEFAULT_THRESHOLDS.nudgeAfterDays + 2) });
    const today = await getTodayData({ clientId: client.id, campaignId });
    const videoRows = today.rows.filter((r) => r.section === "waiting_video");
    check("waiting on video: the longest-waiting first", videoRows[0]?.partnershipId === late && videoRows[1]?.partnershipId === recent, videoRows.map((r) => r.name).join(","));
    check("…the late one says so, with a Late badge", videoRows[0]?.badge === "late" && /the video is late/.test(videoRows[0]?.note ?? ""));
    check("…the recent one says when it arrived", videoRows[1]?.badge === null && videoRows[1]?.note === "Delivered 5 days ago.");
    const nudged = today.rows.find((r) => r.partnershipId === quiet);
    check("a deal gone quiet at Talking is back on Follow up", nudged?.section === "follow_up" && /nudge them/.test(nudged?.note ?? ""), JSON.stringify(nudged && { s: nudged.section, n: nudged.note }));
    check("…but not one moved there this morning", today.rows.find((r) => r.partnershipId === fresh2)?.section === "waiting");

    console.log("\n── Snooze ──");
    const sleepy = await add("__verify_td_snooze");
    await changeStage(sleepy, "in_conversation");
    await setSnooze(sleepy, new Date(Date.now() + 3 * 86_400_000), "back from SEMA on the 10th", "Sam Teammate");
    const [row] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, sleepy));
    check("the stage it's snoozed at comes from the database", row.snoozeStage === "in_conversation" && row.snoozedByName === "Sam Teammate" && !!row.snoozedAt);
    const rowOf = async () => (await getTodayData({ clientId: client.id, campaignId })).rows.find((r) => r.partnershipId === sleepy);
    const asleep = await rowOf();
    check("a snoozed creator sits in Snoozed, with when and why", asleep?.section === "snoozed" && asleep.snooze?.reason === "back from SEMA on the 10th" && asleep.snooze.by === "Sam Teammate");
    await db.insert(schema.cmOutreachEvents).values({ partnershipId: sleepy, direction: "outbound", channel: "ig_dm", kind: "follow_up", occurredAt: new Date() });
    await db.insert(schema.cmOutreachEvents).values({ partnershipId: sleepy, direction: "inbound", channel: "email", kind: "note", occurredAt: new Date() });
    check("our own message or an invite doesn't wake it", (await rowOf())?.section === "snoozed");
    await db.insert(schema.cmOutreachEvents).values({ partnershipId: sleepy, direction: "inbound", channel: "ig_dm", kind: "reply", occurredAt: new Date(Date.now() - 86_400_000) });
    check("their message stored after the snooze wakes it — even one dated yesterday", (await rowOf())?.section !== "snoozed");
    const moved = await add("__verify_td_snooze_moved");
    await setSnooze(moved, new Date(Date.now() + 3 * 86_400_000), null, null);
    await changeStage(moved, "contacted");
    check("a stage change wakes it", (await rowOf()) !== undefined && (await getTodayData({ clientId: client.id, campaignId })).rows.find((r) => r.partnershipId === moved)?.section !== "snoozed");
    const cleared = await add("__verify_td_snooze_cleared");
    await setSnooze(cleared, new Date(Date.now() + 3 * 86_400_000), null, null);
    await setSnooze(cleared, null, null, null);
    const [c2] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, cleared));
    check("Bring back now clears it", c2.snoozedUntil === null && c2.snoozeStage === null && (await getTodayData({ clientId: client.id, campaignId })).rows.find((r) => r.partnershipId === cleared)?.section !== "snoozed");
  } finally {
    if (creatorIds.length) await db.delete(schema.cmCreators).where(inArray(schema.cmCreators.id, creatorIds));
    await db.delete(schema.cmCampaigns).where(and(eq(schema.cmCampaigns.id, campaignId)));
  }
  check("test rows cleaned up", (await db.select().from(schema.cmCampaigns).where(eq(schema.cmCampaigns.id, campaignId))).length === 0);
}

main().then(
  () => {
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
