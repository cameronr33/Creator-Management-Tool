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
import { getCreatorRows, getStageSince } from "../src/lib/queries";
import { getTodayData } from "../src/lib/today-data";
import { DEFAULT_THRESHOLDS } from "../src/lib/thresholds";
import { restoreArchived, setArchived, getLastInboundStoredAt } from "../src/lib/archive";
import { splitArchived } from "../src/lib/archive-rules";

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

    console.log("\n── Archive ──");
    const put = await add("__verify_td_archive");
    await changeStage(put, "in_conversation");
    await setArchived([put], { until: null, reason: "waiting for HELLA's next launch", byName: "Sam Teammate" });
    const [row] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, put));
    check("the stage it's archived at comes from the database", row.archiveStage === "in_conversation" && row.archivedByName === "Sam Teammate" && !!row.archivedAt && row.archivedUntil === null);
    const todayNow = () => getTodayData({ clientId: client.id, campaignId });
    const t1 = await todayNow();
    check("an archived creator isn't on Today at all — and is counted", !t1.rows.some((r) => r.partnershipId === put) && t1.archivedCount === 1, `${t1.archivedCount}`);
    const lists = async () => {
      const rows = await getCreatorRows(client.id, { campaignId, withOutreach: false });
      return splitArchived(rows, await getLastInboundStoredAt(rows.map((r) => r.partnershipId)));
    };
    const l1 = await lists();
    check("…nor on the Pipeline or the Creators list (the split both use)", l1.archived.some((r) => r.partnershipId === put) && !l1.active.some((r) => r.partnershipId === put));
    await db.insert(schema.cmOutreachEvents).values({ partnershipId: put, direction: "outbound", channel: "ig_dm", kind: "follow_up", occurredAt: new Date() });
    await db.insert(schema.cmOutreachEvents).values({ partnershipId: put, direction: "inbound", channel: "email", kind: "note", occurredAt: new Date() });
    check("our own message or an invite doesn't bring them back", !(await todayNow()).rows.some((r) => r.partnershipId === put));
    await db.insert(schema.cmOutreachEvents).values({ partnershipId: put, direction: "inbound", channel: "ig_dm", kind: "reply", occurredAt: new Date(Date.now() - 86_400_000) });
    const back = (await todayNow()).rows.find((r) => r.partnershipId === put);
    check("their message stored after it brings them back — even one dated yesterday — and says so", back?.backFromArchive?.why === "wrote" && back.backFromArchive.reason === "waiting for HELLA's next launch", JSON.stringify(back?.backFromArchive));
    // NEGATIVE (plan review, 2026-09-29): the stage matched again after a move away and back, so the archive switched itself back on.
    const moved = await add("__verify_td_archive_moved");
    await changeStage(moved, "in_conversation");
    await setArchived([moved], { until: null, reason: null, byName: null });
    await changeStage(moved, "awaiting_address");
    const [m1] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, moved));
    check("a stage move clears the archive", m1.archivedAt === null && m1.archiveStage === null && m1.archiveReason === null);
    await changeStage(moved, "in_conversation");
    check("…so moving back into that stage later doesn't archive them again", (await todayNow()).rows.some((r) => r.partnershipId === moved));
    const many = [await add("__verify_td_archive_b1"), await add("__verify_td_archive_b2")];
    const n = await setArchived(many, { until: null, reason: null, byName: null });
    const t2 = await todayNow();
    check("several archived at once", n === 2 && !t2.rows.some((r) => many.includes(r.partnershipId)));
    await restoreArchived(many);
    const [r1] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, many[0]));
    check("Restore puts them back and clears it", r1.archivedAt === null && (await todayNow()).rows.filter((r) => many.includes(r.partnershipId)).length === 2);
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
