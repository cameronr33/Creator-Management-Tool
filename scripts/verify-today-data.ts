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
    await db.insert(schema.cmOutreachEvents).values({ partnershipId: quiet, direction: "outbound", channel: "ig_dm", kind: "follow_up", occurredAt: daysAgo(DEFAULT_THRESHOLDS.nudgeAfterDays + 2) });
    const today = await getTodayData({ clientId: client.id, campaignId });
    const videoRows = today.rows.filter((r) => r.section === "waiting_video");
    check("waiting on video: the longest-waiting first", videoRows[0]?.partnershipId === late && videoRows[1]?.partnershipId === recent, videoRows.map((r) => r.name).join(","));
    check("…the late one says so, with a Late badge", videoRows[0]?.badge === "late" && /the video is late/.test(videoRows[0]?.note ?? ""));
    check("…the recent one says when it arrived", videoRows[1]?.badge === null && videoRows[1]?.note === "Delivered 5 days ago.");
    const nudged = today.rows.find((r) => r.partnershipId === quiet);
    check("a deal gone quiet at Talking is back on Follow up", nudged?.section === "follow_up" && /nudge them/.test(nudged?.note ?? ""), JSON.stringify(nudged && { s: nudged.section, n: nudged.note }));
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
