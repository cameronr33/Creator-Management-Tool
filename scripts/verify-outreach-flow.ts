/**
 * Verifies the send-flow plumbing (Phase 2 of the streamlining work).
 *
 *   npm run verify:outreach-flow
 *
 * Part 1 (pure): renderTemplate reason precedence, URL builders.
 * Part 2 (live DB, self-cleaning): an outreach event logged with a custom
 * channel + body round-trips exactly, and the auto-stage hook fires the same
 * way the API route does.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { renderTemplate, firstName, igDmUrl, igProfileUrl, mailtoUrl } from "../src/lib/outreach";
import { applyAutoStage } from "../src/lib/auto-stage";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

async function main() {
  console.log("\n── renderTemplate ──");
  const tpl = "Hey {{name}}, we love your {{content_descriptor}} — {{reason}}!";
  check(
    "all placeholders filled",
    renderTemplate(tpl, { name: "Joe", content_descriptor: "truck builds", reason: "that brake reel" }) ===
      "Hey Joe, we love your truck builds — that brake reel!",
  );
  check(
    "empty reason renders visible [reason] marker",
    renderTemplate(tpl, { name: "Joe", content_descriptor: "x", reason: "" }).includes("[reason]"),
  );
  check(
    "subject templates render too",
    renderTemplate("Partnership with {{name}}", { name: "Joe" }) === "Partnership with Joe",
  );
  check("firstName handles SHOUTED names", firstName("AUTUMN SCHWALBE") === "Autumn");

  console.log("\n── URL builders ──");
  check("igDmUrl", igDmUrl("some_user") === "https://ig.me/m/some_user");
  check("igProfileUrl", igProfileUrl("some_user") === "https://www.instagram.com/some_user/");
  const mail = mailtoUrl("a@b.com", "Hi there", "Line one\nLine two");
  check("mailto has address", mail.startsWith("mailto:a@b.com?"));
  check("mailto encodes subject spaces as %20 not +", mail.includes("subject=Hi%20there"), mail);
  check("mailto encodes newline", mail.includes("Line%20one%0ALine%20two"), mail);
  check("mailto without subject", mailtoUrl("a@b.com", null, "x") === "mailto:a@b.com?body=x");

  console.log("\n── Live: event logging round-trip (cleaned up after) ──");
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

  const campaignId = await ensureCampaignByName(client.id, "__verify_outreach_flow__");
  const { creatorId, partnershipId } = await createCreatorWithPartnership({
    clientId: client.id,
    name: "Verify Outreach Flow",
    links: ["https://www.instagram.com/__verify_of_test__"],
    campaignId,
    stage: "shortlisted",
  });

  try {
    // Mirror what the worklist's markSent posts: edited body, email channel, subject.
    await db.insert(schema.cmOutreachEvents).values({
      partnershipId,
      direction: "outbound",
      channel: "email",
      kind: "initial",
      body: "Hand-edited message text",
      subject: "Partnership with Verify",
    });
    const changed = await applyAutoStage(partnershipId, "outbound_message");
    check("stage advanced shortlisted → contacted", changed?.to === "contacted");

    const [ev] = await db
      .select()
      .from(schema.cmOutreachEvents)
      .where(eq(schema.cmOutreachEvents.partnershipId, partnershipId));
    check("channel stored as email (not hardcoded ig_dm)", ev.channel === "email");
    check("body is the edited text, not the template", ev.body === "Hand-edited message text");
    check("subject stored", ev.subject === "Partnership with Verify");

    // One-click reply shape.
    await db.insert(schema.cmOutreachEvents).values({
      partnershipId,
      direction: "inbound",
      channel: "email",
      kind: "reply",
    });
    const replied = await applyAutoStage(partnershipId, "inbound_message");
    check("reply advanced contacted → in_conversation", replied?.to === "in_conversation");

    // outreachReason persists through the partnerships PATCH shape.
    await db
      .update(schema.cmPartnerships)
      .set({ outreachReason: "loved the brake-swap reel" })
      .where(eq(schema.cmPartnerships.id, partnershipId));
    const [p] = await db
      .select({ outreachReason: schema.cmPartnerships.outreachReason })
      .from(schema.cmPartnerships)
      .where(eq(schema.cmPartnerships.id, partnershipId));
    check("outreachReason round-trips", p.outreachReason === "loved the brake-swap reel");
  } finally {
    await db.delete(schema.cmCreators).where(eq(schema.cmCreators.id, creatorId));
    await db.delete(schema.cmCampaigns).where(eq(schema.cmCampaigns.id, campaignId));
  }
  const leftover = await db
    .select({ id: schema.cmPartnerships.id })
    .from(schema.cmPartnerships)
    .where(eq(schema.cmPartnerships.id, partnershipId));
  check("test rows cascade-deleted", leftover.length === 0);
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
