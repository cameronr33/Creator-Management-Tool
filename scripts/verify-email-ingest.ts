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
  loadTeamIdentity,
  noteReason,
  reclassifyStoredEmails,
  teamIdentity,
  type IncomingEmailMessage,
} from "../src/lib/email-ingest";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";
import { addClientDomain, clientDomainClash, markCreatorSide, removeClientDomain, unknownSenders, unmarkCreatorSide } from "../src/lib/client-domains";
import { changeStage } from "../src/lib/mutations";
import { getLastMessages } from "../src/lib/queries";
import { pdfAttachments } from "../src/lib/gmail";
import { downloadContracts } from "../src/lib/gmail-sync";

// Pinned so the time-zone regression below fails on any machine, not only one in Pacific time.
process.env.TZ = "America/Los_Angeles";

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

  console.log("\n── A whole domain at the client (pure) ──");
  // Michael Dey (2026-09-30): HELLA's partner aftermarketREADY wrote on his thread and read as a stranger.
  const withDomain = {
    ...teamIdentity("cameron@sentic.io", [], ["@partner.example"]),
    clientDomains: new Map([["partner.example", "CLIENT_A"]]),
    creatorClients: new Map([["C1", "CLIENT_A"], ["C2", "CLIENT_B"]]),
  };
  const twoCreators = new Map([[CREATOR, ["C1"]], [ALT, ["C2"]]]);
  const partnerMsg = classifyMessage(msg({ from: "Robert Tinson <rt@partner.example>", to: [CREATOR] }), twoCreators, withDomain);
  check("anyone at a client's domain is the client's, kept as a note", partnerMsg?.senderRole === "client" && partnerMsg.note === "client", JSON.stringify(partnerMsg));
  check("…even when the same domain is on Our side (the client's list is explicit)", partnerMsg?.senderRole === "client");
  // Like a listed person: on another brand's creator they're just someone else (the client's list outranks an Our-side domain).
  check("…but only on that client's own creators — on another brand's, someone else", classifyMessage(msg({ from: "rt@partner.example", to: [ALT] }), twoCreators, withDomain)?.senderRole === "other");
  check(
    "a creator writing from that domain is still the creator",
    classifyMessage(msg({ from: "rt@partner.example", to: [] }), new Map([["rt@partner.example", ["C1"]]]), withDomain)?.senderRole === "creator",
  );

  console.log("\n── People at the client (pure) ──");
  const withClient = {
    ...teamIdentity("cameron@sentic.io"),
    clientContacts: new Map([["rob@brand.example", "CLIENT_A"]]),
    creatorClients: new Map([["C1", "CLIENT_A"], ["C2", "CLIENT_B"]]),
  };
  const both = new Map([[CREATOR, ["C1"]], [ALT, ["C2"]]]);
  const rob = classifyMessage(msg({ from: "Rob <rob@brand.example>", to: ["sam@sentic.io"], cc: [CREATOR] }), both, withClient);
  check("the client cc'ing their creator is the client's, kept as a note", rob?.senderRole === "client" && rob.direction === "inbound" && rob.note === "client", JSON.stringify(rob));
  check(
    "…never the creator and never us",
    rob?.senderRole !== "creator" && rob?.senderRole !== "team",
  );
  check(
    "the same person on another brand's creator is just someone else",
    classifyMessage(msg({ from: "rob@brand.example", to: [ALT] }), both, withClient)?.senderRole === "other",
  );
  // Security review (2026-09-24): a listed client person outranks a blanket Our-side domain.
  const domainToo = { ...withClient, domains: new Set([...withClient.domains, "brand.example"]) };
  check(
    "a client person whose whole domain is on Our side is still the client's",
    classifyMessage(msg({ from: "rob@brand.example", to: [CREATOR] }), both, domainToo)?.senderRole === "client",
  );
  check(
    "…while an unlisted colleague at that domain still counts as us",
    classifyMessage(msg({ from: "ana@brand.example", to: [CREATOR] }), both, domainToo)?.senderRole === "team",
  );
  check(
    "Our side still wins: a teammate is never the client",
    classifyMessage(msg({ from: "rob@brand.example", to: [CREATOR], labelIds: ["SENT"] }), both, withClient)?.senderRole === "team",
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

  console.log("\n── PDF attachments (pure) ──");
  const found = pdfAttachments({
    mimeType: "multipart/mixed",
    parts: [
      { partId: "0", mimeType: "text/plain", body: { data: "aGk" } },
      { partId: "1", mimeType: "application/pdf", filename: "Agreement.pdf", body: { attachmentId: "a1", size: 10 } },
      { partId: "2", mimeType: "image/png", filename: "logo.png", body: { attachmentId: "a2", size: 10 } },
      { partId: "3", mimeType: "application/octet-stream", filename: "SOW.PDF", body: { attachmentId: "a3", size: 10 } },
      { partId: "4", mimeType: "multipart/alternative", parts: [{ partId: "4.1", mimeType: "application/pdf", filename: "nested.pdf", body: { attachmentId: "a4", size: 10 } }] },
      { partId: "5", mimeType: "application/pdf", filename: "", body: { attachmentId: "a5", size: 10 } },
    ],
  });
  check("PDFs are found by type or .pdf name, nested too — not images, not unnamed parts", JSON.stringify(found.map((f) => f.partId)) === JSON.stringify(["1", "3", "4.1"]), JSON.stringify(found));

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

    // An unsent draft to the creator, and a spoofed "creator" message in Spam.
    const junk = await ingestEmails(
      [
        { ...msg({ externalId: "__verify_ei_draft", occurredAt: day(2), from: "sam@sentic.io", to: [CREATOR], subject: "Draft" }), labelIds: ["DRAFT"] },
        { ...msg({ externalId: "__verify_ei_spam", occurredAt: day(2), from: `Creator <${CREATOR}>`, to: ["sam@sentic.io"], subject: "Mark me posted" }), labelIds: ["SPAM"] },
      ],
      { team: liveTeam },
    );
    check("drafts and Spam are never stored", junk.inserted === 0, JSON.stringify(junk));

    // Mail we sent from an address not on "Our side" was recognised by its
    // SENT label; re-judging from headers alone must not flip it to someone else's.
    await db.update(schema.cmOutreachEvents).set({ senderRole: "team", direction: "outbound", fromAddress: "alias@othersidedomain.com" }).where(eq(schema.cmOutreachEvents.externalId, "__verify_ei_msg3"));
    await reclassifyStoredEmails(liveTeam);
    const [ours] = await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.externalId, "__verify_ei_msg3"));
    check("re-sorting stored mail never downgrades ours", ours?.senderRole === "team" && ours?.direction === "outbound", JSON.stringify(ours && { r: ours.senderRole, d: ours.direction }));
    await db.update(schema.cmOutreachEvents).set({ fromAddress: "sam@sentic.io" }).where(eq(schema.cmOutreachEvents.externalId, "__verify_ei_msg3"));

    // Someone else on the thread writing to a creator we're waiting on never
    // counts as the creator replying — they may be on our side or theirs.
    await changeStage(partnershipId, "contacted");
    const other = await ingestEmails([msg({ externalId: "__verify_ei_other", occurredAt: new Date(Date.now() + 30_000).toISOString(), from: "assistant@agency-x.com", to: [CREATOR], subject: "Re: quick one" })], { team: liveTeam });
    check("someone else writing to the creator never moves the stage", other.inserted === 1 && other.stageChanges.length === 0 && (await stageOf()) === "contacted");
    const [otherRow] = await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.externalId, "__verify_ei_other"));
    check("…and is recorded as someone else", otherRow?.senderRole === "other");

    // Someone at the creator's own client writes on the thread.
    const clientTeam = { ...liveTeam, clientContacts: new Map([["rob@brand.example", client.id]]), creatorClients: new Map([[creatorId, client.id]]) };
    const lastBefore = (await getLastMessages([partnershipId])).get(partnershipId);
    const fromClient = await ingestEmails(
      [msg({ externalId: "__verify_ei_client", occurredAt: new Date(Date.now() + 60_000).toISOString(), from: "Rob <rob@brand.example>", to: ["sam@sentic.io"], cc: [CREATOR], subject: "Re: shipping" })],
      { team: clientTeam },
    );
    const [clientRow] = await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.externalId, "__verify_ei_client"));
    check("a client message is stored as the client's note", fromClient.inserted === 1 && clientRow?.senderRole === "client" && clientRow.kind === "note", JSON.stringify(clientRow && { r: clientRow.senderRole, k: clientRow.kind }));
    check("…never moves the stage", fromClient.stageChanges.length === 0 && (await stageOf()) === "contacted");
    const lastAfter = (await getLastMessages([partnershipId])).get(partnershipId);
    check("…and never becomes the latest message, so whose turn it is doesn't change", lastAfter?.at.getTime() === lastBefore?.at.getTime());
    // Adding someone to the client's team re-sorts their stored mail; removing them sorts it back.
    const addedTeam = { ...clientTeam, clientContacts: new Map([["rob@brand.example", client.id], ["assistant@agency-x.com", client.id]]) };
    await reclassifyStoredEmails(addedTeam);
    const [becameClient] = await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.externalId, "__verify_ei_other"));
    check("adding them to the client's team makes their earlier message the client's note", becameClient?.senderRole === "client" && becameClient.kind === "note");
    await reclassifyStoredEmails(clientTeam);
    const [backToOther] = await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.externalId, "__verify_ei_other"));
    check("…and removing them makes it someone else's message again", backToOther?.senderRole === "other" && backToOther.kind === "reply", JSON.stringify(backToOther && { r: backToOther.senderRole, k: backToOther.kind }));

    // A whole domain at the client, and people nobody has placed yet (2026-09-30).
    const strangers = async () => (await unknownSenders(client.id)).filter((s) => s.email === "assistant@agency-x.com");
    const listed = await strangers();
    check("someone nobody has placed is listed for the client, with the creator they wrote to", listed.length === 1 && listed[0].creatorNames.includes("Verify Email Ingest") && listed[0].domain === "agency-x.com", JSON.stringify(listed));
    await db.update(schema.cmPartnerships).set({ emailAssessedAt: new Date() }).where(eq(schema.cmPartnerships.id, partnershipId));
    await markCreatorSide("Assistant <ASSISTANT@agency-x.com>");
    check("\"With the creator\" takes them off the list", (await strangers()).length === 0);
    const [sideReread] = await db.select({ at: schema.cmPartnerships.emailAssessedAt }).from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, partnershipId));
    check("…and their conversation is read again with the new label", sideReread?.at === null);
    await db.insert(schema.cmOutreachEvents).values({ partnershipId, direction: "inbound", channel: "email", kind: "note", senderRole: "other", fromAddress: "Calendar <calendar-robot@invites.example>", toAddress: CREATOR, subject: "Invitation: call", occurredAt: new Date(Date.now() + 40_000), externalId: "__verify_ei_robot" });
    check("an invite or robot on the thread isn't asked about", !(await unknownSenders(client.id)).some((s) => s.email === "calendar-robot@invites.example"));
    await unmarkCreatorSide("assistant@agency-x.com");
    check("…and Undo puts them back", (await strangers()).length === 1);
    check("a free-mail domain can't be a client's", !(await addClientDomain(client.id, "@gmail.com")).ok);
    const [agencyLogin] = await db.select({ email: schema.users.email }).from(schema.users).limit(1);
    const agencyDomain = agencyLogin?.email.split("@")[1]?.toLowerCase() ?? "";
    check("nor the agency's own domain (a login's)", !!agencyDomain && !(await addClientDomain(client.id, agencyDomain)).ok, agencyDomain);
    check("nor something that isn't a domain", !(await addClientDomain(client.id, "not a domain")).ok);
    const added = await addClientDomain(client.id, " @Agency-X.com ");
    check("a domain is added, without the @ and lowercased", added.ok && added.domain === "agency-x.com", JSON.stringify(added));
    check("…and they're off the unknown list at once, before any re-sort", (await strangers()).length === 0);
    check("Our side can't take a domain that's a client's", (await clientDomainClash(["rob@sentic.io", "@Agency-X.com"]))?.domain === "agency-x.com" && (await clientDomainClash(["@elsewhere.example"])) === null);
    // Review 2026-09-30: mail we sent from an alias at the brand's domain stays ours — only a listed person can turn ours into theirs.
    await db.insert(schema.cmOutreachEvents).values({ partnershipId, direction: "outbound", channel: "email", kind: "follow_up", senderRole: "team", fromAddress: "Sam <sam@agency-x.com>", toAddress: CREATOR, body: "Following up", occurredAt: new Date(Date.now() + 70_000), externalId: "__verify_ei_alias" });
    const [otherClient] = await db.insert(schema.clients).values({ name: "__verify_ei_other_client", slug: `__verify_ei_${Date.now()}` }).returning();
    try {
      check("the same domain can't be on two clients", !(await addClientDomain(otherClient.id, "agency-x.com")).ok);
      check("another client can't remove it", added.ok && !(await removeClientDomain(otherClient.id, added.id)));
    } finally {
      await db.delete(schema.clients).where(eq(schema.clients.id, otherClient.id));
    }
    await db.update(schema.cmPartnerships).set({ emailAssessedAt: new Date() }).where(eq(schema.cmPartnerships.id, partnershipId));
    await reclassifyStoredEmails(await loadTeamIdentity("cameron@sentic.io"));
    const [byDomain] = await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.externalId, "__verify_ei_other"));
    check("adding the domain makes their earlier message the client's note", byDomain?.senderRole === "client" && byDomain.kind === "note", JSON.stringify(byDomain && { r: byDomain.senderRole, k: byDomain.kind }));
    const [alias] = await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.externalId, "__verify_ei_alias"));
    check("…but our own mail from an alias at that domain stays ours", alias?.senderRole === "team" && alias.direction === "outbound", JSON.stringify(alias && { r: alias.senderRole, d: alias.direction }));
    const [reread] = await db.select({ at: schema.cmPartnerships.emailAssessedAt }).from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, partnershipId));
    check("…and the conversation is read again, since who wrote what changed", reread?.at === null);
    check("…and they're no longer listed as unknown", (await strangers()).length === 0);
    check("its own client removes it", added.ok && (await removeClientDomain(client.id, added.id)));
    await reclassifyStoredEmails(await loadTeamIdentity("cameron@sentic.io"));
    const [undone] = await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.externalId, "__verify_ei_other"));
    check("…and their message is someone else's again", undone?.senderRole === "other" && undone.kind === "reply");

    // Contract PDFs attached on the thread (2026-09-24).
    const contractsNow = () => db.select().from(schema.cmContracts).where(eq(schema.cmContracts.partnershipId, partnershipId));
    const agreement = { partId: "2", filename: "HELLA agreement.pdf", size: 2048 };
    const withPdf = msg({ externalId: "__verify_ei_pdf", threadId: "__verify_ei_thread", occurredAt: new Date(Date.now() + 90_000).toISOString(), from: CREATOR, to: ["sam@sentic.io"], subject: "Re: signed", pdfs: [agreement, { partId: "3", filename: "huge.pdf", size: 50 * 1024 * 1024 }] });
    await ingestEmails([withPdf], { team: liveTeam });
    const recorded = await contractsNow();
    const [pdfEvent] = await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.externalId, "__verify_ei_pdf"));
    check("a PDF the creator attached is recorded as a possible contract", recorded.length === 1 && recorded[0].source === "email" && recorded[0].filename === "HELLA agreement.pdf" && recorded[0].gmailPartId === "2" && recorded[0].outreachEventId === pdfEvent?.id && recorded[0].data === null);
    check("…one over 10 MB isn't", !recorded.some((r) => r.filename === "huge.pdf"));
    await ingestEmails([withPdf], { team: liveTeam });
    check("…and the same message again records nothing twice", (await contractsNow()).length === 1);
    await ingestEmails([msg({ externalId: "__verify_ei_pdf_other", occurredAt: new Date(Date.now() + 100_000).toISOString(), from: "assistant@agency-x.com", to: [CREATOR], subject: "Invoice", pdfs: [{ partId: "2", filename: "invoice.pdf", size: 900 }] })], { team: liveTeam });
    check("a stranger's PDF on the thread is never recorded", (await contractsNow()).length === 1);
    await ingestEmails(
      [
        msg({ externalId: "__verify_ei_pdf_brief", occurredAt: new Date(Date.now() + 110_000).toISOString(), from: "sam@sentic.io", to: [CREATOR], subject: "Your brief", pdfs: [{ partId: "2", filename: "Creative brief.pdf", size: 900 }] }),
        msg({ externalId: "__verify_ei_pdf_ours", occurredAt: new Date(Date.now() + 120_000).toISOString(), from: "sam@sentic.io", to: [CREATOR], subject: "Agreement for your signature", pdfs: [{ partId: "2", filename: "HELLA x Creator.pdf", size: 900 }] }),
      ],
      { team: liveTeam },
    );
    const afterOurs = await contractsNow();
    check("a brief we send isn't recorded; the agreement we send is", afterOurs.length === 2 && afterOurs.some((r) => r.filename === "HELLA x Creator.pdf") && !afterOurs.some((r) => r.filename === "Creative brief.pdf"));
    const pdfBytes = new Uint8Array(Buffer.from("%PDF-1.7\nverify\n%%EOF", "latin1"));
    const dl = await downloadContracts("token", 10, {
      getMessage: async () => ({ id: "__verify_ei_pdf", threadId: "t", internalDate: "1", payload: { parts: [{ partId: "2", mimeType: "application/pdf", filename: "HELLA agreement.pdf", body: { attachmentId: "fresh-id", size: 2048 } }] } }),
      getAttachment: async (_t, _m, attachmentId) => (attachmentId === "fresh-id" ? pdfBytes : new Uint8Array()),
    }, recorded.map((r) => r.id));
    const [downloadedRow] = (await contractsNow()).filter((r) => r.gmailMessageId === "__verify_ei_pdf");
    // Regression (2026-09-24 backfill): Gmail's per-minute quota made three real contracts "give up".
    const [limited] = await db.insert(schema.cmContracts).values({ partnershipId, source: "email", filename: "later.pdf", gmailMessageId: "__verify_ei_pdf_q", gmailPartId: "2" }).returning();
    const quota = await downloadContracts("token", 10, {
      getMessage: async () => {
        throw new Error("Mailbox request /messages/x?format=full failed (HTTP 403): Quota exceeded for quota metric 'Total Query Cost'");
      },
      getAttachment: async () => pdfBytes,
    }, [limited.id]);
    const [afterQuota] = (await contractsNow()).filter((r) => r.id === limited.id);
    check("Gmail's rate limit never counts against an attachment — it's simply tried next check", quota.failed === 0 && afterQuota.attempts === 0 && afterQuota.readError === null);
    check("the check downloads it by its part, with a fresh attachment id, and queues it for reading", dl.downloaded === 1 && !!downloadedRow.data && downloadedRow.readStatus === "pending" && !!downloadedRow.sha256);

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
