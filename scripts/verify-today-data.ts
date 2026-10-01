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
import { answerStageFlag } from "../src/lib/stage-flag-answer";
import { markPromiseDone, undoPromiseDone } from "../src/lib/promise-answer";
import { moveStage } from "../src/lib/stage-moves";

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

    console.log("\n── Stage looks out of date: Move or Keep ──");
    const dey = await add("__verify_td_flag");
    await changeStage(dey, "awaiting_address");
    // Set Agreed an hour ago (like the sheet import); the email that reads as Talking came a minute ago.
    await db.update(schema.cmStageTransitions).set({ changedAt: new Date(Date.now() - 3_600_000) }).where(and(eq(schema.cmStageTransitions.partnershipId, dey), eq(schema.cmStageTransitions.toStage, "awaiting_address")));
    const readAt = (ms: number) => new Date(Date.now() + ms);
    await db.update(schema.cmPartnerships).set({ emailStage: "in_conversation", emailStageQuote: "We can't move forward on that build", emailStageAt: readAt(-60_000) }).where(eq(schema.cmPartnerships.id, dey));
    const flagRow = async () => (await getTodayData({ clientId: client.id, campaignId })).rows.find((r) => r.partnershipId === dey);
    const f1 = await flagRow();
    check("Today asks, with the line from their emails", f1?.section === "check_stage" && f1.stageFlag?.suggested === "in_conversation" && f1.stageFlag.quote === "We can't move forward on that build", JSON.stringify(f1 && { s: f1.section, f: f1.stageFlag }));
    // Review 2026-09-29: asking about the stage mustn't hide the row's own next step.
    check("…and still knows the row's own next step (their address)", f1?.stageFlag?.beneath === "get_address", String(f1?.stageFlag?.beneath));
    const kept = await answerStageFlag(dey, "keep", "awaiting_address", null);
    check("Keep: the stage stays and Today stops asking", kept.ok && (await flagRow())?.section === "get_address");
    await db.update(schema.cmPartnerships).set({ emailStageAt: readAt(60_000) }).where(eq(schema.cmPartnerships.id, dey));
    check("…until a newer message reads differently", (await flagRow())?.section === "check_stage");
    const stale = await answerStageFlag(dey, "move", "finalizing", null);
    check("Move on a page that's out of date: refused as stale, nothing moves", !stale.ok && !!stale.stale && (await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, dey)))[0].stage === "awaiting_address");
    const moved2 = await answerStageFlag(dey, "move", "awaiting_address", null);
    const [afterMove] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, dey));
    const [flagMove] = (await db.select().from(schema.cmStageTransitions).where(eq(schema.cmStageTransitions.partnershipId, dey))).filter((t) => t.reason === "their emails read as Talking");
    check("Move: back to Talking, as a person's move with the reason and the line", moved2.ok && afterMove.stage === "in_conversation" && flagMove?.source === "manual" && (flagMove.meta as { quote?: string } | null)?.quote === "We can't move forward on that build");
    check("…and Today stops asking", (await flagRow())?.section !== "check_stage");

    console.log("\n── We said we'd get back to them: Mark done, Undo ──");
    const promiser = await add("__verify_td_promise");
    await changeStage(promiser, "in_conversation");
    await db.update(schema.cmPartnerships).set({ promiseText: "Circle back with launch dates", promiseQuote: "We will circle back with you once we have specific launch dates.", promiseAt: new Date(Date.now() - 54 * 86_400_000) }).where(eq(schema.cmPartnerships.id, promiser));
    const promiseRow = async () => (await getTodayData({ clientId: client.id, campaignId })).rows.find((r) => r.partnershipId === promiser);
    const pr1 = await promiseRow();
    check("Today lists the open promise, with the line we wrote", pr1?.section === "promised" && pr1.promise?.quote === "We will circle back with you once we have specific launch dates." && pr1.note === "Promised 54 days ago: circle back with launch dates.", JSON.stringify(pr1 && { s: pr1.section, n: pr1.note, p: pr1.promise }));
    const done = await markPromiseDone(promiser);
    check("Mark done takes it off", !!done && (await promiseRow())?.section !== "promised");
    check("…a second Mark done finds nothing open", (await markPromiseDone(promiser)) === null);
    check("Undo with the wrong moment does nothing", !(await undoPromiseDone(promiser, new Date(0))) && (await promiseRow())?.section !== "promised");
    check("Undo with the moment it was marked brings it back", !!done && (await undoPromiseDone(promiser, done)) && (await promiseRow())?.section === "promised");

    // Review 2026-09-30: the reader said it's our turn because of the promise — Mark done must not drop the row into Your turn.
    const theirMail = new Date(Date.now() - 50 * 86_400_000);
    await db.insert(schema.cmOutreachEvents).values({ partnershipId: promiser, direction: "inbound", channel: "email", kind: "reply", senderRole: "creator", body: "I'll be here when you're ready!", occurredAt: theirMail, externalId: "__verify_td_promise_mail" });
    await db.update(schema.cmPartnerships).set({ emailSummary: "Waiting on launch dates.", emailSummaryAt: theirMail, emailWhoseTurn: "us" }).where(eq(schema.cmPartnerships.id, promiser));
    check("…(with the reader saying it's our turn, the promise is what's listed)", (await promiseRow())?.section === "promised");
    const done2 = await markPromiseDone(promiser);
    const afterDone = await promiseRow();
    check("Mark done takes it off without dropping it into Your turn", !!done2 && afterDone?.section !== "promised" && afterDone?.section !== "your_turn" && afterDone?.whoseTurn !== "us", JSON.stringify(afterDone && { s: afterDone.section, t: afterDone.whoseTurn }));
    check("…and Undo puts it back, whose turn and all", !!done2 && (await undoPromiseDone(promiser, done2)) && (await promiseRow())?.section === "promised");
    const [restored] = await db.select({ handled: schema.cmPartnerships.replyHandledAt }).from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, promiser));
    check("…restoring what No reply needed was before", restored?.handled === null);
    // A new promise in a message sent just before Mark done is a new promise.
    const [ev1] = await db.insert(schema.cmOutreachEvents).values({ partnershipId: promiser, direction: "outbound", channel: "email", kind: "follow_up", senderRole: "team", body: "We'll circle back with dates.", occurredAt: new Date(Date.now() - 49 * 86_400_000) }).returning();
    await db.update(schema.cmPartnerships).set({ promiseEventId: ev1.id }).where(eq(schema.cmPartnerships.id, promiser));
    await markPromiseDone(promiser);
    const [ev2] = await db.insert(schema.cmOutreachEvents).values({ partnershipId: promiser, direction: "outbound", channel: "email", kind: "follow_up", senderRole: "team", body: "Here are the dates — we'll ship your kit next week.", occurredAt: new Date(Date.now() - 60_000) }).returning();
    await db.update(schema.cmPartnerships).set({ promiseText: "Ship their kit next week", promiseEventId: ev2.id, promiseAt: ev2.occurredAt }).where(eq(schema.cmPartnerships.id, promiser));
    check("a promise in a message sent just before Mark done still shows", (await promiseRow())?.section === "promised");

    // Review 2026-09-29: the flag must not undo automation that knew more than the emails.
    const flagged = async (h: string) => {
      const id = await add(h);
      await changeStage(id, "awaiting_address");
      await db.update(schema.cmStageTransitions).set({ changedAt: new Date(Date.now() - 3_600_000) }).where(eq(schema.cmStageTransitions.partnershipId, id));
      await db.update(schema.cmPartnerships).set({ emailStage: "in_conversation", emailStageQuote: "Let's talk about it", emailStageAt: readAt(-60_000) }).where(eq(schema.cmPartnerships.id, id));
      return id;
    };
    const sectionOf = async (id: string) => (await getTodayData({ clientId: client.id, campaignId })).rows.find((r) => r.partnershipId === id)?.section;
    const byRule = await flagged("__verify_td_flag_rule");
    await moveStage({ partnershipId: byRule, to: "finalizing", source: "rule", expectFrom: "awaiting_address", reason: "an unsigned contract" });
    check("a rule's move after that message wins (an unsigned contract moved them to Finalizing)", (await sectionOf(byRule)) !== "check_stage", String(await sectionOf(byRule)));
    const byEmail = await flagged("__verify_td_flag_email");
    await moveStage({ partnershipId: byEmail, to: "finalizing", source: "email", expectFrom: "awaiting_address", reason: "I'll be here when you're ready!" });
    check("…but the email reader's own move doesn't: a person is still asked", (await sectionOf(byEmail)) === "check_stage", String(await sectionOf(byEmail)));
    const shipping = await flagged("__verify_td_flag_ship");
    await db.insert(schema.cmShipments).values({ partnershipId: shipping, status: "ready" });
    check("never once a shipment exists (moved back from Ready to ship to fix the address)", (await sectionOf(shipping)) !== "check_stage", String(await sectionOf(shipping)));
    const refused = await answerStageFlag(shipping, "move", "awaiting_address", null);
    check("…and Move is refused there too", !refused.ok);

    console.log("\n── Archive ──");
    const put = await add("__verify_td_archive");
    await changeStage(put, "in_conversation");
    await setArchived([put], { until: null, reason: "waiting for HELLA's next launch", byName: "Sam Teammate" });
    const [row] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, put));
    check("the stage it's archived at comes from the database", row.archiveStage === "in_conversation" && row.archivedByName === "Sam Teammate" && !!row.archivedAt && row.archivedUntil === null);
    const todayNow = () => getTodayData({ clientId: client.id, campaignId });
    const t1 = await todayNow();
    check("an archived creator isn't on Today at all — and is counted", !t1.rows.some((r) => r.partnershipId === put) && t1.archivedCount === 1, `${t1.archivedCount}`);
    // Review 2026-09-29: a campaign whose creators are all archived is "all caught up", not "no creators yet".
    const onCampaign = (await getCreatorRows(client.id, { campaignId, withOutreach: false })).length;
    check("…and still counts as a creator on the campaign", t1.totalCreators === onCampaign, `${t1.totalCreators} of ${onCampaign}`);
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
