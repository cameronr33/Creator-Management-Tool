/**
 * Verifies the "latest message" line (Pipeline cards, Today rows) and where
 * each creator lands on Today. Pure — no database.
 *
 *   npm run preview:verify -- scripts/verify-today.ts
 */
import { latestActivity, type LastMessage } from "../src/lib/activity";
import { placeOnToday, TODAY_SECTIONS, type TodayFacts } from "../src/lib/today";
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
check("they wrote last → Your turn", place({ stage: "in_conversation", whoseTurn: "us" })?.section === "your_turn");
check("Talking and waiting on them → Waiting", place({ stage: "in_conversation" })?.section === "waiting");
check("Contacted, not yet due → Waiting", place({})?.section === "waiting");
check(
  `Contacted ${DEFAULT_THRESHOLDS.followUp1AfterDays}+ days with no reply → Follow up`,
  place({ now: new Date(at(20).getTime() + DEFAULT_THRESHOLDS.followUp1AfterDays * 86_400_000) })?.section === "follow_up",
);
check("imported rows never get a follow-up clock", place({ datesAreMigrated: true, now: at(30) })?.section === "waiting");
check("after two follow-ups, suggests closing once the wait is over", /No response/.test(place({ followUpCount: 2, now: new Date(at(20).getTime() + DEFAULT_THRESHOLDS.markNoResponseAfterDays * 86_400_000) })?.note ?? ""));
check("Agreed → get the address", place({ stage: "awaiting_address" })?.section === "get_address");
check("Ready to ship stays Ready to ship even when it's our turn", place({ stage: "fulfilling", whoseTurn: "us" })?.section === "ready_to_ship");
check("Shipped → on the way", place({ stage: "shipped" })?.section === "shipped");
check("Waiting on video → add the link", place({ stage: "content_pending" })?.section === "waiting_video");
check("a retired stage is placed as the stage it now means", place({ stage: "agreed" })?.section === "get_address");
check("the section list covers every placement", STAGE_VALUES.filter((s) => !isTerminal(s)).every((s) => { const p = place({ stage: s }); return !p || TODAY_SECTIONS.some((t) => t.key === p.section); }));

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
