/**
 * Verifies the "latest message" line (Pipeline cards, Today rows) and where
 * each creator lands on Today. Pure — no database.
 *
 *   npm run preview:verify -- scripts/verify-today.ts
 */
import { latestActivity, type LastMessage } from "../src/lib/activity";
import { placeOnToday, sortToday, TODAY_SECTIONS, type TodayFacts, listedOnToday } from "../src/lib/today";
import { THRESHOLD_FIELDS, THRESHOLDS_SCHEMA } from "../src/lib/thresholds";
import { ARCHIVE_REMIND_MAX_DAYS, archiveActive, archiveWoke, parseRemindOn, splitArchived } from "../src/lib/archive-rules";
import { DEFAULT_THRESHOLDS } from "../src/lib/outreach";
import { ACTIVE_STAGES, STAGE_VALUES, isTerminal } from "../src/lib/stages";
import type { CmStage } from "../src/lib/db/schema";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const at = (d: number) => new Date(Date.UTC(2026, 8, d, 12));
const msg = (over: Partial<LastMessage>): LastMessage => ({ at: at(20), direction: "inbound", channel: "email", senderRole: "creator", subject: "Re: HELLA lights", isMigrated: false, ...over });
const none = { emailSummary: null, emailSummaryAt: null, emailWhoseTurn: null, replyHandledAt: null };

console.log("\n── The latest-message line ──");
check("no messages says so", latestActivity({ last: null, ...none }).text === "No messages yet");
const theirs = latestActivity({ last: msg({}), ...none });
check("their email: who, how, subject without Re:", theirs.text === "They emailed: “HELLA lights”" && theirs.whoseTurn === "us", JSON.stringify(theirs));
check("our email means we're waiting on them", latestActivity({ last: msg({ direction: "outbound" }), ...none }).whoseTurn === "them");
check("a logged DM reads as a DM", latestActivity({ last: msg({ direction: "outbound", channel: "ig_dm", subject: null }), ...none }).text === "We sent a DM");
check("someone else on their thread is named as such", latestActivity({ last: msg({ senderRole: "other" }), ...none }).text.startsWith("Someone on their thread"));
const summarised = latestActivity({ last: msg({}), emailSummary: "Signed the contract.", emailSummaryAt: at(20), emailWhoseTurn: "them", replyHandledAt: null });
check("a current email summary wins, with its whose-turn", summarised.text === "Signed the contract." && summarised.fromEmail && summarised.whoseTurn === "them");
const stale = latestActivity({ last: msg({ at: at(21), direction: "outbound", channel: "ig_dm" }), emailSummary: "Signed the contract.", emailSummaryAt: at(20), emailWhoseTurn: "us", replyHandledAt: null });
check("a DM logged after the summary replaces it (the summary is old news)", stale.text === "We sent a DM" && !stale.fromEmail && stale.whoseTurn === "them", JSON.stringify(stale));
check("No reply needed clears Your turn until they write again", latestActivity({ last: msg({}), ...none, replyHandledAt: at(21) }).whoseTurn === "none");
check("…but a newer message from them brings it back", latestActivity({ last: msg({ at: at(22) }), ...none, replyHandledAt: at(21) }).whoseTurn === "us");
const imported = latestActivity({ last: msg({ isMigrated: true, channel: "ig_dm" }), ...none });
check("imported rows never show an invented date", imported.at === null && /date unknown/.test(imported.text));

console.log("\n── Where each creator lands on Today ──");
const base: TodayFacts = { stage: "contacted", whoseTurn: "them", lastOutboundAt: at(20), followUpCount: 0, datesAreMigrated: false, thresholds: DEFAULT_THRESHOLDS, now: at(21) };
const place = (over: Partial<TodayFacts>) => placeOnToday({ ...base, ...over });
check("every section has a title and an explanation", TODAY_SECTIONS.every((s) => s.title && s.hint.length > 10));
check("posted and closed deals aren't on Today", (["posted", "passed", "declined", "no_response"] as CmStage[]).every((s) => place({ stage: s }) === null));
check("every other current stage has a place", ACTIVE_STAGES.filter((s) => s.value !== "posted").every((s) => place({ stage: s.value }) !== null));
check("To contact → To contact", place({ stage: "shortlisted", whoseTurn: null })?.section === "to_contact");
check("To contact but waiting on the client → Waiting on client approval", place({ stage: "shortlisted", whoseTurn: null, clientApproval: "pending" })?.section === "waiting_approval");
check("…approved by the client → To contact", place({ stage: "shortlisted", whoseTurn: null, clientApproval: "approved" })?.section === "to_contact");
check("they wrote last → Your turn", place({ stage: "in_conversation", whoseTurn: "us" })?.section === "your_turn");
check("Talking and waiting on them → Waiting", place({ stage: "in_conversation" })?.section === "waiting");
check("Contacted, not yet due → Waiting", place({})?.section === "waiting");
check(
  `Contacted ${DEFAULT_THRESHOLDS.followUp1AfterDays}+ days with no reply → Follow up`,
  place({ now: new Date(at(20).getTime() + DEFAULT_THRESHOLDS.followUp1AfterDays * 86_400_000) })?.section === "follow_up",
);
check("imported rows never get a follow-up clock", place({ datesAreMigrated: true, now: at(30) })?.section === "waiting");
// NEGATIVE (run-through, 2026-09-29): the follow-up line repeated the row's latest-message line ("Last message 67 days ago · 1 follow-up sent").
const due1 = place({ now: new Date(at(20).getTime() + DEFAULT_THRESHOLDS.followUp1AfterDays * 86_400_000) });
const due2 = place({ followUpCount: 1, now: new Date(at(20).getTime() + DEFAULT_THRESHOLDS.followUp2AfterDays * 86_400_000) });
check("a due follow-up says which one is due, not when we last wrote (the row shows that already)", due1?.note === "Follow-up 1 is due." && due2?.note === "Follow-up 2 is due.", `${due1?.note} / ${due2?.note}`);
check("after two follow-ups, suggests closing once the wait is over", /No response/.test(place({ followUpCount: 2, now: new Date(at(20).getTime() + DEFAULT_THRESHOLDS.markNoResponseAfterDays * 86_400_000) })?.note ?? ""));
check("Agreed → get the address", place({ stage: "awaiting_address" })?.section === "get_address");
check("Finalizing → its own section, saying when they wrote last", place({ stage: "finalizing" })?.section === "finalizing" && place({ stage: "finalizing", whoseTurn: "us" })?.note === "They wrote last — reply.");
check("Ready to ship stays Ready to ship even when it's our turn", place({ stage: "fulfilling", whoseTurn: "us" })?.section === "ready_to_ship");
check("Shipped → on the way", place({ stage: "shipped" })?.section === "shipped");
check("Waiting on video → add the link", place({ stage: "content_pending" })?.section === "waiting_video");
check("a retired stage is placed as the stage it now means", place({ stage: "agreed" })?.section === "get_address");
check("the section list covers every placement", STAGE_VALUES.filter((s) => !isTerminal(s)).every((s) => { const p = place({ stage: s }); return !p || TODAY_SECTIONS.some((t) => t.key === p.section); }));

console.log("\n── Nudges for quiet deals (2026-09-28) ──");
const daysAfter = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const quiet = (stage: CmStage, over: Partial<TodayFacts> = {}) =>
  place({ stage, whoseTurn: "them", lastFrom: "us", lastMessageAt: at(20), now: daysAfter(at(20), DEFAULT_THRESHOLDS.nudgeAfterDays), ...over });
// Copy (review, 2026-09-28): "No reply in N days" was wrong when their promise was the last message — "Quiet" is true either way.
check("Talking, we wrote, no reply for the nudge days → Follow up", quiet("in_conversation")?.section === "follow_up" && quiet("in_conversation")?.note === `Quiet for ${DEFAULT_THRESHOLDS.nudgeAfterDays} days — nudge them.`);
check("Agreed gone quiet → Follow up, asking for the address", quiet("awaiting_address")?.section === "follow_up" && /for their address/.test(quiet("awaiting_address")?.note ?? ""));
check("Finalizing gone quiet → Follow up, about what's open", quiet("finalizing")?.section === "follow_up" && /still open/.test(quiet("finalizing")?.note ?? ""));
check("…a day earlier they stay where they were", quiet("in_conversation", { now: daysAfter(at(20), DEFAULT_THRESHOLDS.nudgeAfterDays - 1) })?.section === "waiting" && quiet("awaiting_address", { now: daysAfter(at(20), DEFAULT_THRESHOLDS.nudgeAfterDays - 1) })?.section === "get_address");
check("they wrote last (our turn) → never a nudge", quiet("in_conversation", { whoseTurn: "us", lastFrom: "them" })?.section === "your_turn" && quiet("finalizing", { whoseTurn: "us", lastFrom: "them" })?.section === "finalizing");
check("they promised something and went quiet (their turn, their message last) → nudged", quiet("awaiting_address", { lastFrom: "them" })?.section === "follow_up");
check("nothing pending (a thank-you) → no nudge", quiet("in_conversation", { whoseTurn: "none" })?.section === "waiting");
check("imported rows (no date) never get a nudge clock", quiet("in_conversation", { lastMessageAt: null })?.section === "waiting" && quiet("awaiting_address", { lastMessageAt: null })?.section === "get_address");
check("fulfilment stages are never nudged", (["fulfilling", "shipped", "content_pending"] as CmStage[]).every((s) => quiet(s)?.section !== "follow_up"));
check("a client's own nudge days are used", quiet("in_conversation", { thresholds: { ...DEFAULT_THRESHOLDS, nudgeAfterDays: 9 } })?.section === "waiting" && quiet("in_conversation", { thresholds: { ...DEFAULT_THRESHOLDS, nudgeAfterDays: 2 } })?.section === "follow_up");
// NEGATIVE (review, 2026-09-28): moving a deal to Agreed after a long-quiet DM thread nudged it the same instant.
const movedLate = daysAfter(at(20), DEFAULT_THRESHOLDS.nudgeAfterDays - 1);
check("a stage move since restarts the quiet clock", quiet("awaiting_address", { stageSince: movedLate })?.section === "get_address" && quiet("finalizing", { stageSince: movedLate })?.section === "finalizing");
const restarted = quiet("awaiting_address", { stageSince: movedLate, now: daysAfter(movedLate, DEFAULT_THRESHOLDS.nudgeAfterDays) });
check("…and nudges once it has been quiet that long since the move", restarted?.section === "follow_up" && restarted.since?.getTime() === movedLate.getTime() && restarted.note === `Quiet for ${DEFAULT_THRESHOLDS.nudgeAfterDays} days — nudge them for their address.`);

console.log("\n── Waiting since, Due and Late ──");
check("Your turn waits since their message", place({ stage: "in_conversation", whoseTurn: "us", lastMessageAt: at(18) })?.since?.getTime() === at(18).getTime());
check("Follow up waits since our last message", place({ now: at(28) })?.since?.getTime() === at(20).getTime());
check("Agreed / Ready to ship wait since the stage began", place({ stage: "awaiting_address", stageSince: at(15) })?.since?.getTime() === at(15).getTime() && place({ stage: "fulfilling", stageSince: at(16) })?.since?.getTime() === at(16).getTime());
const toContact = (over: Partial<TodayFacts>) => place({ stage: "shortlisted", whoseTurn: null, ...over });
check("To contact: due after the first-message days, with a Due badge", toContact({ stageSince: at(20), now: daysAfter(at(20), DEFAULT_THRESHOLDS.initialOutreachAfterDays) })?.badge === "due" && /first message is due/.test(toContact({ stageSince: at(20), now: daysAfter(at(20), 3) })?.note ?? ""));
// Copy (review, 2026-09-28): "Added N days ago" was wrong when the clock started at approval or a move back.
check("…saying how long they've been ready to contact", toContact({ stageSince: at(20), now: daysAfter(at(20), 3) })?.note === "Ready to contact for 3 days — the first message is due.");
check("…not before", toContact({ stageSince: at(20), now: daysAfter(at(20), DEFAULT_THRESHOLDS.initialOutreachAfterDays - 1) })?.badge === null);
check("…and the clock starts at the client's approval when that's later", toContact({ stageSince: at(10), approvalAt: at(20), now: daysAfter(at(20), 1) })?.badge === null);
check("Shipped says when it went out", place({ stage: "shipped", shippedAt: at(18) })?.note === "Shipped 3 days ago." && place({ stage: "shipped", shippedAt: at(18) })?.since?.getTime() === at(18).getTime());
check("…or that no ship date was recorded", /no ship date recorded/.test(place({ stage: "shipped", stageSince: at(18) })?.note ?? ""));
check("one day reads as one day", place({ stage: "shipped", stageSince: at(20), now: daysAfter(at(20), 1) })?.note === "In Shipped for 1 day — no ship date recorded.");
const video = (n: number, over: Partial<TodayFacts> = {}) => place({ stage: "content_pending", deliveredAt: at(1), now: daysAfter(at(1), n), ...over });
check(`Waiting on video: late from ${DEFAULT_THRESHOLDS.videoDueAfterDays} days after delivery`, video(DEFAULT_THRESHOLDS.videoDueAfterDays)?.badge === "late" && /the video is late/.test(video(DEFAULT_THRESHOLDS.videoDueAfterDays)?.note ?? ""));
check("…not a day before", video(DEFAULT_THRESHOLDS.videoDueAfterDays - 1)?.badge === null && video(DEFAULT_THRESHOLDS.videoDueAfterDays - 1)?.note === `Delivered ${DEFAULT_THRESHOLDS.videoDueAfterDays - 1} days ago.`);
check("…a stage moved there by hand counts from when it moved", /no delivery date recorded/.test(video(3, { deliveredAt: null, stageSince: at(1) })?.note ?? ""));
check("…one day of it reads as one day", video(1, { deliveredAt: null, stageSince: at(1) })?.note === "Waiting on the video for 1 day — no delivery date recorded.");
check("what Today lists at all agrees with where it places them (Posted and closed never)", STAGE_VALUES.every((s) => listedOnToday(s) === (place({ stage: s }) !== null)) && !listedOnToday("posted") && !listedOnToday("no_response") && listedOnToday("shortlisted"));
check("…and with no date at all there's no clock", video(30, { deliveredAt: null, stageSince: null })?.badge === null && video(30, { deliveredAt: null, stageSince: null })?.since === null);
const sorted = sortToday([
  { name: "Cy", since: at(12).toISOString() },
  { name: "Al", since: null },
  { name: "Bo", since: at(10).toISOString() },
  { name: "Ab", since: at(12).toISOString() },
]);
check("whoever has waited longest comes first; unknown dates last; ties by name", sorted.map((r) => r.name).join(",") === "Bo,Ab,Cy,Al", sorted.map((r) => r.name).join(","));

// Archive replaced Snooze (owner, 2026-09-29): the same bring-back rules under the new names, plus archives with no date.
console.log("\n── Archive (2026-09-29) ──");
const archivedFacts = { archivedAt: at(20), archivedUntil: at(25) as Date | null, archiveStage: "in_conversation" as CmStage, stage: "in_conversation" as CmStage, lastInboundStoredAt: null as Date | null, now: at(22) };
check("archived before the reminder date", archiveActive(archivedFacts));
check("back on the reminder date, saying so", !archiveActive({ ...archivedFacts, now: at(25) }) && archiveWoke({ ...archivedFacts, now: at(25) }) === "reminder");
check("with no reminder date it stays archived, however long", archiveActive({ ...archivedFacts, archivedUntil: null, now: daysAfter(at(20), 400) }));
check("a message from them stored after it brings them back, saying so", !archiveActive({ ...archivedFacts, lastInboundStoredAt: at(21) }) && archiveWoke({ ...archivedFacts, lastInboundStoredAt: at(21) }) === "wrote");
check("…one stored before it doesn't", archiveActive({ ...archivedFacts, lastInboundStoredAt: at(19) }));
check("a stage change brings them back", !archiveActive({ ...archivedFacts, stage: "awaiting_address" }));
check("never archived: never hidden, never 'back'", !archiveActive({ ...archivedFacts, archivedAt: null }) && archiveWoke({ ...archivedFacts, archivedAt: null }) === null);
const now22 = at(22);
check("no reminder date is allowed", (() => { const r = parseRemindOn(null, now22); return r.ok && r.until === null; })());
check("a reminder in the past or today is refused", !parseRemindOn(at(21).toISOString(), now22).ok && !parseRemindOn(now22.toISOString(), now22).ok);
check(`a reminder at most ${ARCHIVE_REMIND_MAX_DAYS} days away`, parseRemindOn(daysAfter(now22, ARCHIVE_REMIND_MAX_DAYS).toISOString(), now22).ok && !parseRemindOn(daysAfter(now22, ARCHIVE_REMIND_MAX_DAYS + 1).toISOString(), now22).ok);
check("nonsense is refused", !parseRemindOn("soon", now22).ok);
const lists = splitArchived(
  [
    { partnershipId: "p1", stage: "in_conversation" as CmStage, archivedAt: at(20), archivedUntil: null, archiveStage: "in_conversation" as CmStage },
    { partnershipId: "p2", stage: "contacted" as CmStage, archivedAt: null, archivedUntil: null, archiveStage: null },
  ],
  new Map(),
  at(22),
);
check("the lists split the archived from the rest", lists.archived.map((r) => r.partnershipId).join() === "p1" && lists.active.map((r) => r.partnershipId).join() === "p2");
check("Today has no archived (or snoozed) section — archived creators aren't listed at all", !TODAY_SECTIONS.some((t) => ["snoozed", "archived"].includes(t.key as string)));

console.log("\n── The timing table ──");
check("the field table, the defaults and the settings schema have the same keys", JSON.stringify(THRESHOLD_FIELDS.map((f) => f.key).sort()) === JSON.stringify(Object.keys(DEFAULT_THRESHOLDS).sort()));
check("the settings schema takes the new keys", THRESHOLDS_SCHEMA.safeParse({ nudgeAfterDays: 4, videoDueAfterDays: 21 }).success);
check("…and refuses an unknown one or a fraction", !THRESHOLDS_SCHEMA.safeParse({ nudgeDays: 4 }).success && !THRESHOLDS_SCHEMA.safeParse({ nudgeAfterDays: 2.5 }).success);
check("the owner's defaults: nudge after 5, video due after 14", DEFAULT_THRESHOLDS.nudgeAfterDays === 5 && DEFAULT_THRESHOLDS.videoDueAfterDays === 14);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
