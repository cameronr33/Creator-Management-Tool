/**
 * Verifies logging a message by hand with when and how (2026-09-28).
 *
 *   npm run preview:verify -- scripts/verify-logging.ts
 *
 * Part 1 (pure): the date limits, how the conversation groups mail the
 * mailbox holds apart from everything logged by hand, and how the email
 * reader's prompt labels each.
 * Part 2 (live DB, self-cleaning): a backdated message keeps its date and
 * starts the follow-up clock from it; a message dated before a person's last
 * stage change never moves the stage — an old reply logged late doesn't
 * reopen a deal someone closed as No response (frozen node 2); an email
 * logged by hand is never queued for, sent to, or re-labelled by the email
 * reader. Throwaway __verify_ rows, cleaned up in finally.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { LOG_MAX_PAST_DAYS, logMessage, resolveOccurredAt } from "../src/lib/logging";
import { groupThreads, type ThreadEvent } from "../src/lib/conversation";
import {
  assessPartnership,
  buildPrompt,
  decideEmailMove,
  partnershipsNeedingRead,
  verifiedAddress,
  verifiedDeal,
  verifiedPostUrl,
  type Assessment,
  type AssessFn,
  type PromptMessage,
} from "../src/lib/email-status";
import { recomputeEmailKinds } from "../src/lib/email-ingest";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";
import { changeStage } from "../src/lib/mutations";
import { getCreatorRows } from "../src/lib/queries";
import { getTodayData } from "../src/lib/today-data";
import { DEFAULT_THRESHOLDS } from "../src/lib/thresholds";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const near = (a: Date | null | undefined, b: Date, ms = 5_000) => !!a && Math.abs(a.getTime() - b.getTime()) < ms;

function pure() {
  console.log("\n── When it happened: the limits ──");
  const now = new Date("2026-09-28T15:00:00Z");
  const none = resolveOccurredAt(undefined, now);
  check("no date means now, and says it wasn't supplied", none.ok && none.at.getTime() === now.getTime() && !none.supplied);
  check("an empty string means now too", (() => { const r = resolveOccurredAt("", now); return r.ok && !r.supplied; })());
  const yest = resolveOccurredAt(new Date(now.getTime() - DAY).toISOString(), now);
  check("yesterday is kept as given", yest.ok && yest.at.getTime() === now.getTime() - DAY && yest.supplied);
  check("not a date is refused", !resolveOccurredAt("next tuesday", now).ok);
  check("the future is refused", !resolveOccurredAt(new Date(now.getTime() + 60 * 60_000).toISOString(), now).ok);
  const skew = resolveOccurredAt(new Date(now.getTime() + 2 * 60_000).toISOString(), now);
  check("a clock a couple of minutes fast is clamped to now, not refused", skew.ok && skew.at.getTime() === now.getTime());
  check(`${LOG_MAX_PAST_DAYS} days back is allowed`, resolveOccurredAt(new Date(now.getTime() - LOG_MAX_PAST_DAYS * DAY).toISOString(), now).ok);
  check(`${LOG_MAX_PAST_DAYS + 1} days back is refused`, !resolveOccurredAt(new Date(now.getTime() - (LOG_MAX_PAST_DAYS + 1) * DAY).toISOString(), now).ok);

  console.log("\n── The conversation: mailbox threads vs logged by hand ──");
  const ev = (id: string, channel: string, externalId: string | null, threadId: string | null, at: number, subject: string | null = null): ThreadEvent => ({
    id,
    occurredAt: new Date(at),
    channel,
    threadId,
    subject,
    fromAddress: null,
    toAddress: null,
    messageId: null,
    externalId,
  });
  const threads = groupThreads([
    ev("a", "email", "gm-1", "t1", 1_000, "HELLA x you"),
    ev("b", "email", "gm-2", "t1", 2_000, "Re: HELLA x you"),
    ev("c", "email", "gm-3", null, 3_000, "Loose one"),
    ev("d", "email", null, null, 4_000, "From my own inbox"),
    ev("e", "ig_dm", null, null, 5_000),
  ]);
  const byKey = new Map(threads.map((t) => [t.key, t]));
  const t1 = byKey.get("t1");
  check("mail the mailbox holds groups by thread, titled without Re:", t1?.isEmail === true && t1.events.map((e) => e.id).join() === "a,b" && t1.title === "HELLA x you");
  check("…one without a thread id stands on its own", byKey.get("email:c")?.events.length === 1);
  const hand = threads.find((t) => !t.isEmail);
  check("an email logged by hand joins the DMs, calls and notes", hand?.events.map((e) => e.id).join() === "d,e", hand?.events.map((e) => e.id).join());
  check("…under a title that says so", /Logged by hand/.test(hand?.title ?? "") && /own inbox/.test(hand?.title ?? ""));
  check("groups come newest first", threads.map((t) => t.key).join() === `${hand?.key},email:c,t1`);

  console.log("\n── The email reader's prompt says what each message is ──");
  const msg = (n: number, m: Partial<PromptMessage>): PromptMessage => ({
    n,
    eventId: String(n),
    occurredAt: new Date("2026-09-20T12:00:00Z"),
    channel: "email",
    synced: true,
    direction: "inbound",
    senderRole: "creator",
    kind: "reply",
    from: null,
    subject: null,
    body: "hello",
    ...m,
  });
  const { user } = buildPrompt({
    creatorName: "Verify Logging",
    campaignName: "Test",
    clientName: "HELLA",
    stage: "in_conversation",
    hasAddress: false,
    shipmentStatuses: [],
    deliverables: 0,
    agreementType: null,
    messages: [
      msg(1, { synced: true }),
      msg(2, { synced: false, direction: "outbound", senderRole: "team", kind: "follow_up", body: null }),
      msg(3, { channel: "other", synced: false, direction: "outbound", senderRole: "team", kind: "note", body: "Called — they want the red one" }),
      msg(4, { synced: true, senderRole: "other", kind: "note", body: "Invitation: call" }),
    ],
  });
  const line = (n: number) => user.split("\n").find((l) => l.startsWith(`[${n}] `)) ?? "";
  check("mail the mailbox holds is plain Email", / · Email · from the creator$/.test(line(1)), line(1));
  check("an email logged by hand says a teammate logged it", /Email logged by a teammate/.test(line(2)), line(2));
  check("a teammate's note is called a note, not an automatic message", /a teammate's internal note/.test(line(3)) && !/calendar invite/.test(line(3)), line(3));
  check("an invite in the mailbox is still called one", /calendar invite \/ automatic message/.test(line(4)), line(4));

  // NEGATIVE (review, 2026-09-28): a teammate's typed note on a hand-logged "They replied" was read as the creator's own
  // email — quotable to move a stage and to fill the address "from their email".
  console.log("\n── Only mail the mailbox holds is anyone's own words ──");
  const words = "Count me in, ship to 12 Oak Street, Austin TX 78701 please";
  const reading: Assessment = {
    stage: "fulfilling",
    whose_turn: "us",
    summary: "They're in.",
    evidence_quote: "Count me in, ship to 12 Oak Street",
    evidence_message: 1,
    address: "12 Oak Street, Austin TX 78701",
    post_url: "https://www.instagram.com/reel/__verify_lg/",
    sounds_like_no: false,
    confidence: "high",
    products: [],
    compensation_type: "flat_fee",
    fee_amount: 500,
    terms: null,
    deal_quote: "Confirming $500 for one reel",
    deal_message: 1,
  };
  const decide = (m: PromptMessage) =>
    decideEmailMove({ current: "awaiting_address", assessment: reading, messages: [m], lastManualChangeAt: null, hasAddress: false, shipmentStatuses: [], automove: true });
  const handEmail = msg(1, { synced: false, body: `${words} https://www.instagram.com/reel/__verify_lg/` });
  const handDm = msg(1, { channel: "ig_dm", synced: false, body: `${words} https://www.instagram.com/reel/__verify_lg/` });
  const mailbox = msg(1, { synced: true, body: `${words} https://www.instagram.com/reel/__verify_lg/` });
  check("an email logged by hand can't be quoted to move the stage", decide(handEmail).move === null);
  check("…nor a DM logged with text", decide(handDm).move === null);
  check("control: the same words in mail the mailbox holds do move it", decide(mailbox).move?.to === "fulfilling");
  check("an address typed on a hand log is never 'what the creator wrote'", verifiedAddress(reading, [handEmail]) === null && verifiedAddress(reading, [handDm]) === null && verifiedAddress(reading, [mailbox])?.text === "12 Oak Street, Austin TX 78701");
  check("nor is a post link", verifiedPostUrl(reading, [handEmail]) === null && verifiedPostUrl(reading, [mailbox]) === "https://www.instagram.com/reel/__verify_lg/");
  const ourHandLog = msg(1, { synced: false, direction: "outbound", senderRole: "team", kind: "reply", body: "Confirming $500 for one reel" });
  const ourMail = msg(1, { synced: true, direction: "outbound", senderRole: "team", kind: "reply", body: "Confirming $500 for one reel" });
  check("a fee typed on a hand log fills nothing; the same line in our sent mail does", verifiedDeal(reading, [ourHandLog], { agreed: true, brand: "HELLA" })?.facts.fee_amount == null && verifiedDeal(reading, [ourMail], { agreed: true, brand: "HELLA" })?.facts.fee_amount === 500);
}

async function live() {
  console.log("\n── Live: backdating, the stage rule, and email logged by hand (cleaned up after) ──");
  const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.slug, "hella")).limit(1);
  const [me] = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  if (!client || !me) {
    check("HELLA and a teammate exist to test with", false);
    return;
  }
  let campaignId = "00000000-0000-0000-0000-000000000000";
  const creatorIds: string[] = [];
  const add = async (h: string) => {
    const r = await createCreatorWithPartnership({ clientId: client.id, name: h, links: [`https://www.instagram.com/${h}`], campaignId });
    creatorIds.push(r.creatorId);
    return r.partnershipId;
  };
  const stageOf = async (id: string) => (await db.select({ s: schema.cmPartnerships.stage }).from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, id)))[0]?.s;
  const eventsOf = (id: string) => db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.partnershipId, id));
  const backdate = async (id: string, toStage: "contacted" | "no_response" | "shortlisted", at: Date) =>
    db.update(schema.cmStageTransitions).set({ changedAt: at }).where(and(eq(schema.cmStageTransitions.partnershipId, id), eq(schema.cmStageTransitions.toStage, toStage)));
  try {
    campaignId = await ensureCampaignByName(client.id, "__verify_logging__");

    // A batch of DMs logged the next morning keeps the day they were sent.
    const late = await add("__verify_lg_backdated");
    const sentAt = daysAgo(DEFAULT_THRESHOLDS.followUp1AfterDays + 1);
    const r1 = await logMessage({ partnershipId: late, direction: "outbound", channel: "ig_dm", kind: "initial", occurredAt: sentAt.toISOString() }, me.id);
    const [e1] = await eventsOf(late);
    check("a message logged with a date is stored with that date, and who logged it", near(e1?.occurredAt, sentAt) && e1?.createdBy === me.id);
    check("…it still moves To contact → Contacted (no one set the stage by hand since)", r1.ok && r1.stageChanged?.to === "contacted" && !r1.stageSkipped && (await stageOf(late)) === "contacted");
    const row = (await getCreatorRows(client.id, { campaignId, withOutreach: true })).find((r) => r.partnershipId === late);
    check("…the follow-up clock starts on that date, not when it was typed", near(row?.lastOutboundAt, sentAt), row?.lastOutboundAt?.toISOString());
    const onToday = (await getTodayData({ clientId: client.id, campaignId })).rows.find((r) => r.partnershipId === late);
    check("…so Today already shows the follow-up as due", onToday?.section === "follow_up", onToday?.section);

    // Refusals write nothing.
    const future = await logMessage({ partnershipId: late, direction: "outbound", channel: "ig_dm", kind: "follow_up", occurredAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString() }, me.id);
    check("a date in the future is refused, and nothing is stored", !future.ok && (await eventsOf(late)).length === 1);

    // NEGATIVE (frozen node 2): an old reply logged late doesn't reopen a deal someone closed.
    const closed = await add("__verify_lg_closed");
    await changeStage(closed, "contacted", me.id);
    await changeStage(closed, "no_response", me.id, { exitReason: "went_dark" });
    const old = await logMessage({ partnershipId: closed, direction: "inbound", channel: "ig_dm", kind: "reply", occurredAt: daysAgo(2).toISOString() }, me.id);
    check("a reply dated before someone closed it as No response doesn't reopen it", old.ok && old.stageSkipped && old.stageChanged === null && (await stageOf(closed)) === "no_response");
    check("…but it's on the timeline", (await eventsOf(closed)).some((e) => e.direction === "inbound" && near(e.occurredAt, daysAgo(2))));
    const now1 = await logMessage({ partnershipId: closed, direction: "inbound", channel: "ig_dm", kind: "reply" }, me.id);
    check("…a reply logged as just now does reopen it (their own message after the close)", now1.ok && now1.stageChanged?.from === "no_response" && now1.stageChanged?.to === "in_conversation" && !now1.stageSkipped);

    const closedEarlier = await add("__verify_lg_closed_earlier");
    await changeStage(closedEarlier, "contacted", me.id);
    await changeStage(closedEarlier, "no_response", me.id, { exitReason: "went_dark" });
    await backdate(closedEarlier, "contacted", daysAgo(4));
    await backdate(closedEarlier, "no_response", daysAgo(3));
    const yest = await logMessage({ partnershipId: closedEarlier, direction: "inbound", channel: "ig_dm", kind: "reply", occurredAt: daysAgo(1).toISOString() }, me.id);
    check("a reply dated after the close (yesterday; closed 3 days ago) reopens it", yest.ok && yest.stageChanged?.to === "in_conversation" && !yest.stageSkipped);

    // NEGATIVE (review, 2026-09-28): the one-time stage clean-up counted as "a person set the stage".
    const migrated = await add("__verify_lg_migrated");
    await db.insert(schema.cmStageTransitions).values({ partnershipId: migrated, fromStage: "researched", toStage: "shortlisted", source: "migration", reason: "stages simplified: researched → shortlisted", changedAt: daysAgo(6) });
    const olderDm = await logMessage({ partnershipId: migrated, direction: "outbound", channel: "ig_dm", kind: "initial", occurredAt: daysAgo(8).toISOString() }, me.id);
    check("the stage clean-up isn't a person's say: a DM dated before it still moves them", olderDm.ok && !olderDm.stageSkipped && olderDm.stageChanged?.to === "contacted", JSON.stringify(olderDm));

    // NEGATIVE: a first DM dated before a person's stage change doesn't move it.
    const decided = await add("__verify_lg_decided");
    await changeStage(decided, "contacted", me.id);
    await changeStage(decided, "shortlisted", me.id); // put back at To contact by hand, just now
    const before = await logMessage({ partnershipId: decided, direction: "outbound", channel: "ig_dm", kind: "initial", occurredAt: daysAgo(2).toISOString() }, me.id);
    check("a DM dated before someone set the stage by hand doesn't move it", before.ok && before.stageSkipped && (await stageOf(decided)) === "shortlisted");
    const note = await logMessage({ partnershipId: decided, direction: "outbound", channel: "other", kind: "note", body: "Their manager says next week", occurredAt: daysAgo(2).toISOString() }, me.id);
    check("a note never moves the stage and isn't reported as skipped", note.ok && note.stageChanged === null && !note.stageSkipped);
    const after = await logMessage({ partnershipId: decided, direction: "outbound", channel: "ig_dm", kind: "follow_up" }, me.id);
    check("…the same DM logged as just now does move it", after.ok && after.stageChanged?.to === "contacted");

    // Email logged by hand: nothing stored to read, so the reader never sees it.
    const handMail = await add("__verify_lg_email");
    await logMessage({ partnershipId: handMail, direction: "inbound", channel: "email", kind: "reply", body: "Sounds good — send it over" }, me.id);
    check("an email logged by hand doesn't queue the email reader", !(await partnershipsNeedingRead(500)).includes(handMail));
    let calls = 0;
    const counting: AssessFn = async () => {
      calls++;
      return null;
    };
    const skipped = await assessPartnership(handMail, { apply: true, model: counting, automove: false });
    check("…and reading it never calls the model", calls === 0 && skipped.skipped === "no email in this conversation", skipped.skipped);
    await new Promise((r) => setTimeout(r, 30)); // stored after that reading
    await db.insert(schema.cmOutreachEvents).values({
      partnershipId: handMail,
      direction: "inbound",
      channel: "email",
      kind: "reply",
      senderRole: "creator",
      subject: "Re: HELLA",
      body: "Here's my address",
      occurredAt: new Date(),
      externalId: "__verify_lg_synced_1",
    });
    check("control: mail the mailbox holds does queue it", (await partnershipsNeedingRead(500)).includes(handMail));
    await assessPartnership(handMail, { apply: true, model: counting, automove: false });
    check("control: …and is read", calls === 1);

    // Re-sequencing email keeps what the person chose for one logged by hand.
    const kinds = await add("__verify_lg_kinds");
    await logMessage({ partnershipId: kinds, direction: "outbound", channel: "email", kind: "follow_up", occurredAt: daysAgo(2).toISOString() }, me.id);
    await db.insert(schema.cmOutreachEvents).values({
      partnershipId: kinds,
      direction: "outbound",
      channel: "email",
      kind: "reply",
      senderRole: "team",
      subject: "HELLA",
      body: "Checking in",
      occurredAt: daysAgo(1),
      externalId: "__verify_lg_synced_2",
    });
    const changed = await recomputeEmailKinds([kinds]);
    const after2 = await eventsOf(kinds);
    const handRow = after2.find((e) => !e.externalId);
    const syncedRow = after2.find((e) => e.externalId);
    check("re-sequencing leaves an email logged by hand as the person logged it", handRow?.kind === "follow_up", handRow?.kind);
    check("control: …and re-sequences mail the mailbox holds", syncedRow?.kind === "follow_up" && changed === 1, `${syncedRow?.kind} / ${changed}`);
  } finally {
    if (creatorIds.length) await db.delete(schema.cmCreators).where(inArray(schema.cmCreators.id, creatorIds));
    await db.delete(schema.cmCampaigns).where(eq(schema.cmCampaigns.id, campaignId));
  }
  check("test rows cleaned up", (await db.select().from(schema.cmCampaigns).where(eq(schema.cmCampaigns.id, campaignId))).length === 0);
}

async function main() {
  pure();
  await live();
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
