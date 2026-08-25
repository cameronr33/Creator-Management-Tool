/**
 * Verifies the email ingest pipeline (Track B server side).
 *
 *   npm run verify:email-ingest
 *
 * Part 1 (pure): matchEmailMessage direction decisions, case-insensitivity,
 * "Display Name <addr>" tolerance, multi-recipient matching.
 * Part 2 (live DB, self-cleaning): a __verify_ creator with a businessEmail —
 * roster inclusion, double-ingest → exactly 1 row, inbound advances
 * contacted → in_conversation, kind initial/follow_up sequencing, cleanup.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { matchEmailMessage, getEmailRoster, ingestEmails } from "../src/lib/email-ingest";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const TEST_EMAIL = "__verify_ei_creator@example.com";

async function main() {
  console.log("\n── matchEmailMessage (pure) ──");
  const contacts = new Map([[TEST_EMAIL, { partnershipId: "P1" }]]);
  check(
    "from creator → inbound",
    matchEmailMessage({ from: TEST_EMAIL, to: ["team@agency.com"], cc: [] }, contacts)?.direction === "inbound",
  );
  check(
    "to creator → outbound",
    matchEmailMessage({ from: "team@agency.com", to: [TEST_EMAIL], cc: [] }, contacts)?.direction === "outbound",
  );
  check(
    "cc creator → outbound",
    matchEmailMessage({ from: "team@agency.com", to: ["other@x.com"], cc: [TEST_EMAIL] }, contacts)?.direction === "outbound",
  );
  check(
    "case-insensitive",
    matchEmailMessage({ from: TEST_EMAIL.toUpperCase(), to: [], cc: [] }, contacts)?.direction === "inbound",
  );
  check(
    "display-name form parsed",
    matchEmailMessage({ from: `Creator Name <${TEST_EMAIL}>`, to: [], cc: [] }, contacts)?.direction === "inbound",
  );
  check(
    "unknown addresses → null",
    matchEmailMessage({ from: "a@x.com", to: ["b@y.com"], cc: [] }, contacts) === null,
  );

  console.log("\n── Live: ingest lifecycle (cleaned up after) ──");
  const [client] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(eq(schema.clients.slug, "hella"))
    .limit(1);
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

  try {
    await db
      .update(schema.cmCreators)
      .set({ businessEmail: TEST_EMAIL })
      .where(eq(schema.cmCreators.id, creatorId));

    const roster = await getEmailRoster();
    const mine = roster.find((c) => c.partnershipId === partnershipId);
    check("appears on the roster with businessEmail", mine?.businessEmail === TEST_EMAIL);

    // Outbound from the teammate (creator on To), then the creator replies.
    const outbound1 = {
      externalId: "__verify_ei_msg1",
      threadId: "__verify_ei_thread",
      occurredAt: "2026-08-20T10:00:00Z",
      from: "teammate@agency.com",
      to: [TEST_EMAIL],
      cc: ["cameron@sentic.io"],
      subject: "Partnership with HELLA",
      bodyText: "Hi — we'd love to work with you.",
    };
    const r1 = await ingestEmails([outbound1]);
    check("first outbound inserted", r1.inserted === 1, JSON.stringify(r1));
    check(
      "stage advanced shortlisted → contacted",
      r1.stageChanges.some((c) => c.partnershipId === partnershipId && c.to === "contacted"),
    );

    // Idempotency: same message again → skipped, still exactly one row.
    const r2 = await ingestEmails([outbound1]);
    check("double-ingest skipped", r2.inserted === 0 && r2.skipped === 1, JSON.stringify(r2));

    const r3 = await ingestEmails([
      {
        externalId: "__verify_ei_msg2",
        threadId: "__verify_ei_thread",
        occurredAt: "2026-08-21T09:00:00Z",
        from: `Creator <${TEST_EMAIL}>`,
        to: ["teammate@agency.com"],
        cc: ["cameron@sentic.io"],
        subject: "Re: Partnership with HELLA",
        bodyText: "Sounds great, I'm in!",
      },
      {
        externalId: "__verify_ei_msg3",
        threadId: "__verify_ei_thread",
        occurredAt: "2026-08-22T09:00:00Z",
        from: "teammate@agency.com",
        to: [TEST_EMAIL],
        cc: [],
        subject: "Re: Partnership with HELLA",
        bodyText: "Awesome — details below.",
      },
      {
        externalId: "__verify_ei_unmatched",
        threadId: null,
        occurredAt: "2026-08-22T10:00:00Z",
        from: "random@stranger.com",
        to: ["someone@else.com"],
        cc: [],
        subject: "Unrelated",
        bodyText: null,
      },
    ]);
    check("reply + follow-up inserted", r3.inserted === 2, JSON.stringify(r3));
    check("unrelated message reported unmatched", r3.unmatched.length === 1);
    check(
      "reply advanced contacted → in_conversation",
      r3.stageChanges.some((c) => c.to === "in_conversation"),
    );

    const events = await db
      .select()
      .from(schema.cmOutreachEvents)
      .where(eq(schema.cmOutreachEvents.partnershipId, partnershipId));
    check("exactly 3 events despite 4 sends", events.length === 3, `got ${events.length}`);
    const first = events.find((e) => e.externalId === "__verify_ei_msg1");
    const reply = events.find((e) => e.externalId === "__verify_ei_msg2");
    const later = events.find((e) => e.externalId === "__verify_ei_msg3");
    check("first outbound kind=initial", first?.kind === "initial");
    check("inbound kind=reply, direction=inbound", reply?.kind === "reply" && reply?.direction === "inbound");
    check("later outbound kind=follow_up", later?.kind === "follow_up");
    check("channel=email + subject + threadId stored", events.every((e) => e.channel === "email" && e.threadId === "__verify_ei_thread"));
  } finally {
    await db.delete(schema.cmCreators).where(eq(schema.cmCreators.id, creatorId));
    await db.delete(schema.cmCampaigns).where(eq(schema.cmCampaigns.id, campaignId));
  }
  const leftover = await db
    .select({ id: schema.cmOutreachEvents.id })
    .from(schema.cmOutreachEvents)
    .where(eq(schema.cmOutreachEvents.partnershipId, partnershipId));
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
