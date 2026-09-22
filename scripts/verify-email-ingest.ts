/**
 * Verifies how mailbox messages become creator conversations.
 *
 *   npm run preview:verify -- scripts/verify-email-ingest.ts
 *
 * Part 1 (pure): who sent it (us / the creator / someone else on the
 * thread), invites and auto-replies as notes, which partnership a message is
 * filed on, and the first-message / reply / follow-up sequence.
 * Part 2 (live DB, self-cleaning): a __verify_ creator — roster, idempotent
 * ingest, cc + Message-ID stored, stage rules, kinds re-sequenced, and the
 * guard that an old email never undoes a person's later decision.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import {
  classifyMessage,
  choosePartnership,
  computeKinds,
  getEmailRoster,
  ingestEmails,
  lastManualChangeAt,
  noteReason,
  teamIdentity,
  type IncomingEmailMessage,
} from "../src/lib/email-ingest";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";
import { changeStage } from "../src/lib/mutations";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const CREATOR = "__verify_ei_creator@example.com";
const ALT = "__verify_ei_alt@example.com";

function msg(over: Partial<IncomingEmailMessage>): IncomingEmailMessage {
  return {
    externalId: "x",
    threadId: null,
    occurredAt: "2026-08-20T10:00:00Z",
    from: "someone@example.com",
    to: [],
    cc: [],
    subject: "Hello",
    bodyText: "Hi",
    ...over,
  };
}

async function main() {
  console.log("\n── Who sent it (pure) ──");
  const team = teamIdentity("cameron@sentic.io", ["rob@sentic.io", "freelancer@gmail.com"]);
  const creators = new Map([[CREATOR, ["C1"]]]);
  const c = (m: Partial<IncomingEmailMessage>) => classifyMessage(msg(m), creators, team);
  check("from the creator → inbound from the creator", c({ from: `Creator <${CREATOR}>`, to: ["cameron@sentic.io"] })?.senderRole === "creator");
  check("from the team domain to the creator → outbound", c({ from: "Sam <sam@sentic.io>", to: [CREATOR] })?.direction === "outbound");
  check("our mailbox's SENT label → outbound, whatever the address", c({ from: "alias@elsewhere.com", to: [CREATOR], labelIds: ["SENT"] })?.direction === "outbound");
  check("a teammate login on free mail → outbound", c({ from: "freelancer@gmail.com", to: [CREATOR] })?.direction === "outbound");
  // Regression (reason stated in the P3 commit): this used to be dropped as
  // "not ours". It is part of the creator's conversation — someone else on
  // their thread — so it is kept as inbound, and it is never "our follow-up".
  const manager = c({ from: "manager@talentco.com", to: ["sam@sentic.io"], cc: [CREATOR] });
  check("a manager cc'ing the creator is inbound, never outbound", manager?.direction === "inbound" && manager.senderRole === "other");
  check("case-insensitive and display names", c({ from: CREATOR.toUpperCase(), to: [] })?.direction === "inbound");
  check("no creator address on it → not stored", c({ from: "a@x.com", to: ["b@y.com"] }) === null);
  const freeMailbox = teamIdentity("owner@gmail.com");
  check("a free-mail mailbox never makes the whole domain \"us\"", freeMailbox.domains.size === 0);
  const withSide = teamIdentity("cameron@sentic.io", [], ["@hella.com", "rob@partner.com", "@gmail.com"]);
  check("Our side: a whole client domain counts as us", classifyMessage(msg({ from: "Ana <ana@hella.com>", to: [CREATOR] }), creators, withSide)?.senderRole === "team");
  check("Our side: a single partner address counts as us", classifyMessage(msg({ from: "rob@partner.com", to: [CREATOR] }), creators, withSide)?.direction === "outbound");
  check("Our side: a free-mail domain is never a whole team", !withSide.domains.has("gmail.com"));
  check(
    "…so a parent on gmail.com cc'ing the creator is someone else, not us",
    classifyMessage(msg({ from: "parent@gmail.com", to: [CREATOR] }), creators, freeMailbox)?.senderRole === "other",
  );

  console.log("\n── Invites, auto-replies and robots are notes (pure) ──");
  check("calendar invitation subject", noteReason(msg({ subject: "Invitation: Tatum / HELLA Intro @ Thu Aug 20, 2026 11am" })) === "calendar");
  check("updated invitation subject", noteReason(msg({ subject: "Updated invitation: HELLA / Michael Dey @ Mon Aug 3" })) === "calendar");
  check("accepted invitation subject", noteReason(msg({ subject: "Accepted: HELLA call @ Mon Aug 3, 2026" })) === "calendar");
  check("a calendar attachment", noteReason(msg({ hasCalendar: true })) === "calendar");
  check("Auto-Submitted header", noteReason(msg({ autoSubmitted: "auto-replied" })) === "auto_reply");
  check("Auto-Submitted: no is a person", noteReason(msg({ autoSubmitted: "no" })) === null);
  check("out-of-office subject", noteReason(msg({ subject: "Out of Office: back Monday" })) === "auto_reply");
  check("X-Autoreply header", noteReason(msg({ autoReplyHeader: true })) === "auto_reply");
  check("bulk mail", noteReason(msg({ precedence: "bulk" })) === "automated");
  check("no-reply sender", noteReason(msg({ from: "no-reply@calendar.example.com" })) === "automated");
  check("a normal reply is not a note", noteReason(msg({ subject: "Re: Content Proposal for Hella" })) === null);
  check("…even when it mentions an invitation mid-subject", noteReason(msg({ subject: "Re: thanks for the invitation" })) === null);

  console.log("\n── Which partnership a message is filed on (pure) ──");
  const at = (d: string) => new Date(d);
  const two = {
    partnerships: [
      { id: "OLD", stage: "posted" as const, updatedAt: at("2026-09-01") },
      { id: "NEW", stage: "contacted" as const, updatedAt: at("2026-08-01") },
    ],
  };
  check("the thread's own partnership wins while it's open", choosePartnership({ partnerships: [{ id: "A", stage: "contacted", updatedAt: at("2026-01-01") }, { id: "B", stage: "in_conversation", updatedAt: at("2026-09-01") }] }, "A") === "A");
  check("a finished thread owner hands new mail to the open partnership", choosePartnership(two, "OLD") === "NEW");
  check("no thread: the open partnership, even if another moved later", choosePartnership(two, null) === "NEW");
  check(
    "nothing open: the latest one (a closed creator's reply is still stored)",
    choosePartnership({ partnerships: [{ id: "X", stage: "declined", updatedAt: at("2026-01-01") }, { id: "Y", stage: "passed", updatedAt: at("2026-05-01") }] }, null) === "Y",
  );

  console.log("\n── First message / reply / follow-up (pure) ──");
  const k = computeKinds([
    { id: "e3", direction: "outbound", kind: "follow_up", occurredAt: at("2026-08-03") },
    { id: "e1", direction: "outbound", kind: "follow_up", occurredAt: at("2026-08-01") },
    { id: "n1", direction: "outbound", kind: "note", occurredAt: at("2026-08-02") },
    { id: "e2", direction: "outbound", kind: "follow_up", occurredAt: at("2026-08-02T12:00:00Z") },
    { id: "e4", direction: "inbound", kind: "reply", occurredAt: at("2026-08-04") },
    { id: "e5", direction: "outbound", kind: "follow_up", occurredAt: at("2026-08-05") },
  ]);
  check("the first outbound is the first message", k.get("e1") === "initial");
  check("a second outbound in a row is a follow-up", k.get("e2") === "follow_up" && k.get("e3") === "follow_up");
  check("an inbound is a reply", k.get("e4") === "reply");
  check("our message after theirs is a reply, not a follow-up", k.get("e5") === "reply");
  check("notes stay notes and don't break the sequence", k.get("n1") === "note");

  console.log("\n── Live: ingest lifecycle (cleaned up after) ──");
  const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.slug, "hella")).limit(1);
  if (!client) {
    console.log("  [FAIL] HELLA client not found");
    failures++;
    return;
  }
  const campaignId = await ensureCampaignByName(client.id, "__verify_email_ingest__");
  const { creatorId, partnershipId } = await createCreatorWithPartnership({
    clientId: client.id,
    name: "Verify Email Ingest",
    links: ["https://www.instagram.com/__verify_ei_test__"],
    campaignId,
    stage: "shortlisted",
  });
  const liveTeam = teamIdentity("cameron@sentic.io");
  const stageOf = async () => (await db.select({ s: schema.cmPartnerships.stage }).from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, partnershipId)))[0]?.s;
  const eventsNow = () => db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.partnershipId, partnershipId));

  try {
    await db.update(schema.cmCreators).set({ businessEmail: CREATOR }).where(eq(schema.cmCreators.id, creatorId));
    await db.insert(schema.cmCreatorEmails).values({ creatorId, email: ALT, source: "manual" });
    const roster = await getEmailRoster();
    const mine = roster.find((r) => r.creatorId === creatorId);
    check("roster has both of the creator's addresses", !!mine && mine.addresses.includes(CREATOR) && mine.addresses.includes(ALT));

    const first: IncomingEmailMessage = msg({
      externalId: "__verify_ei_msg1",
      threadId: "__verify_ei_thread",
      occurredAt: new Date(Date.now() - 5 * 86400_000).toISOString(),
      from: "Sam <sam@sentic.io>",
      to: [CREATOR],
      cc: ["cameron@sentic.io"],
      subject: "Partnership with HELLA",
      bodyText: "Hi — we'd love to work with you.",
      messageId: "<verify-1@sentic.io>",
    });
    const r1 = await ingestEmails([first], { team: liveTeam });
    check("first outbound stored", r1.inserted === 1 && r1.touched.includes(partnershipId), JSON.stringify(r1));
    check("…and it moves To contact → Contacted", r1.stageChanges.some((s) => s.to === "contacted"));
    const [stored1] = await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.externalId, "__verify_ei_msg1"));
    check("cc and Message-ID are kept", stored1?.ccAddress === "cameron@sentic.io" && stored1?.messageId === "<verify-1@sentic.io>");
    check("first outbound is the first message", stored1?.kind === "initial");
    const r2 = await ingestEmails([first], { team: liveTeam });
    check("the same message twice is stored once", r2.inserted === 0 && r2.skipped === 1);

    const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
    const r3 = await ingestEmails(
      [
        msg({ externalId: "__verify_ei_msg2", threadId: "__verify_ei_thread", occurredAt: day(4), from: `Creator <${CREATOR}>`, to: ["sam@sentic.io"], subject: "Re: Partnership with HELLA", bodyText: "Sounds great!" }),
        msg({ externalId: "__verify_ei_invite", threadId: "__verify_ei_inv", occurredAt: day(3.5), from: "sam@sentic.io", to: [CREATOR], subject: "Invitation: HELLA intro @ Thu", hasCalendar: true }),
        msg({ externalId: "__verify_ei_msg3", threadId: "__verify_ei_thread", occurredAt: day(3), from: "sam@sentic.io", to: [ALT], subject: "Re: Partnership with HELLA", bodyText: "Great — details below." }),
        msg({ externalId: "__verify_ei_mgr", threadId: "__verify_ei_thread", occurredAt: day(2.5), from: "manager@talentco.com", to: ["sam@sentic.io"], cc: [CREATOR], subject: "Re: Partnership with HELLA", bodyText: "Looping in on rates." }),
        msg({ externalId: "__verify_ei_stranger", occurredAt: day(2), from: "random@stranger.com", to: ["someone@else.com"], subject: "Unrelated" }),
      ],
      { team: liveTeam },
    );
    check("four of the creator's messages stored, the stranger's not", r3.inserted === 4 && r3.unmatched === 1, JSON.stringify(r3));
    check("their reply moves Contacted → Talking", r3.stageChanges.some((s) => s.to === "in_conversation"));
    const byId = new Map((await eventsNow()).map((e) => [e.externalId, e]));
    check("the invite is a note", byId.get("__verify_ei_invite")?.kind === "note");
    check("our answer after their reply is a reply", byId.get("__verify_ei_msg3")?.kind === "reply" && byId.get("__verify_ei_msg3")?.direction === "outbound");
    check("the manager's message is inbound", byId.get("__verify_ei_mgr")?.direction === "inbound");
    check("nothing from the stranger was stored anywhere", !(await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.externalId, "__verify_ei_stranger"))).length);

    // Someone else on the thread writing to a creator we're waiting on never
    // counts as the creator replying — they may be on our side or theirs.
    await changeStage(partnershipId, "contacted");
    const other = await ingestEmails([msg({ externalId: "__verify_ei_other", occurredAt: new Date(Date.now() + 30_000).toISOString(), from: "assistant@agency-x.com", to: [CREATOR], subject: "Re: quick one" })], { team: liveTeam });
    check("someone else writing to the creator never moves the stage", other.inserted === 1 && other.stageChanges.length === 0 && (await stageOf()) === "contacted");
    const [otherRow] = await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.externalId, "__verify_ei_other"));
    check("…and is recorded as someone else", otherRow?.senderRole === "other");

    // Regression: max(changed_at) came back as a zone-less string and
    // new Date() read it as local time — 7 hours off in Pacific, which would
    // block every email move for 7 hours after any manual change.
    const probeAt = Date.now();
    await changeStage(partnershipId, "in_conversation");
    await changeStage(partnershipId, "contacted");
    const lm = (await lastManualChangeAt([partnershipId])).get(partnershipId);
    check("the last manual change reads back as the real time, not shifted by a time zone", !!lm && Math.abs(lm.getTime() - probeAt) < 60_000, lm?.toISOString());

    // A person closes the deal; an older reply arriving later (a backfill)
    // must not reopen it. A newer one does.
    await changeStage(partnershipId, "no_response");
    const closedAt = Date.now();
    const oldReply = await ingestEmails([msg({ externalId: "__verify_ei_old", occurredAt: new Date(closedAt - 86400_000).toISOString(), from: CREATOR, to: ["sam@sentic.io"], subject: "Re: old" })], { team: liveTeam });
    check("an old reply never reopens a later close", oldReply.inserted === 1 && oldReply.stageChanges.length === 0 && (await stageOf()) === "no_response");
    const newReply = await ingestEmails([msg({ externalId: "__verify_ei_new", occurredAt: new Date(closedAt + 60_000).toISOString(), from: CREATOR, to: ["sam@sentic.io"], subject: "Re: new" })], { team: liveTeam });
    check("a reply sent after the close reopens it", newReply.stageChanges.some((s) => s.from === "no_response" && s.to === "in_conversation"));
    const transitions = await db.select().from(schema.cmStageTransitions).where(eq(schema.cmStageTransitions.partnershipId, partnershipId));
    check("email-triggered moves cite the message", transitions.filter((t) => t.source === "rule").every((t) => !!t.evidenceEventId));

    await changeStage(partnershipId, "declined");
    check("a closed creator stays on the roster (their reply is still stored)", (await getEmailRoster()).some((r) => r.creatorId === creatorId));
  } finally {
    await db.delete(schema.cmCreators).where(eq(schema.cmCreators.id, creatorId));
    await db.delete(schema.cmCampaigns).where(eq(schema.cmCampaigns.id, campaignId));
  }
  const leftover = await db.select({ id: schema.cmOutreachEvents.id }).from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.partnershipId, partnershipId));
  check("events cascade-deleted with the creator", leftover.length === 0);
}

main()
  .then(() => {
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
