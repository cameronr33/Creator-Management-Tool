/**
 * Verifies the auto-stage engine.
 *
 *   npm run verify:auto-stage
 *
 * Part 1 asserts the FULL pure rule matrix — every trigger × every stage —
 * so any change to the rule table must be made deliberately here too.
 * Part 2 walks a live partnership through the trigger chain against the
 * database using throwaway __verify_ rows, asserting cm_stage_transitions
 * audit rows, then cleans up everything it created.
 */
import { eq, asc } from "drizzle-orm";
import { db, schema } from "./db";
import { nextStageFor, applyAutoStage, type AutoStageTrigger } from "../src/lib/auto-stage";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";
import type { CmStage } from "../src/lib/db/schema";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const ALL_STAGES = schema.cmStageEnum.enumValues;

/** The expected rule table, restated independently of the implementation. */
const EXPECTED: Record<AutoStageTrigger, { from: CmStage[]; to: CmStage }> = {
  outbound_message: { from: ["researched", "shortlisted"], to: "contacted" },
  // no_response is the one terminal a creator's OWN late reply reopens.
  inbound_message: { from: ["contacted", "no_response"], to: "in_conversation" },
  address_complete: { from: ["awaiting_address"], to: "fulfilling" },
  shipment_shipped: { from: ["agreed", "awaiting_address"], to: "fulfilling" },
  shipment_delivered: {
    from: ["agreed", "awaiting_address", "fulfilling"],
    to: "content_pending",
  },
  deliverable_added: { from: ["fulfilling", "content_pending"], to: "posted" },
};

async function main() {
  console.log("\n── Pure rule matrix (every trigger × every stage) ──");
  for (const trigger of Object.keys(EXPECTED) as AutoStageTrigger[]) {
    const rule = EXPECTED[trigger];
    for (const stage of ALL_STAGES) {
      const expected = rule.from.includes(stage) ? rule.to : null;
      const actual = nextStageFor(stage, trigger);
      if (actual !== expected) {
        check(`${trigger} @ ${stage}`, false, `expected ${expected}, got ${actual}`);
      }
    }
  }
  const matrixSize = Object.keys(EXPECTED).length * ALL_STAGES.length;
  check(`full ${matrixSize}-cell matrix matches the expected rule table`, failures === 0);
  check(
    "passed/declined are never advanced by any trigger",
    (["passed", "declined"] as CmStage[]).every((s) =>
      (Object.keys(EXPECTED) as AutoStageTrigger[]).every((t) => nextStageFor(s, t) === null),
    ),
  );
  check(
    "no_response reopens ONLY on the creator's own reply",
    nextStageFor("no_response", "inbound_message") === "in_conversation" &&
      (["outbound_message", "address_complete", "shipment_shipped", "shipment_delivered", "deliverable_added"] as AutoStageTrigger[]).every(
        (t) => nextStageFor("no_response", t) === null,
      ),
  );
  check(
    "no rule moves an ACTIVE stage backward",
    (Object.keys(EXPECTED) as AutoStageTrigger[]).every((t) =>
      EXPECTED[t].from
        .filter((f) => f !== "no_response")
        .every((f) => ALL_STAGES.indexOf(EXPECTED[t].to) > ALL_STAGES.indexOf(f)),
    ),
  );

  console.log("\n── Live lifecycle (throwaway rows, cleaned up after) ──");
  const [client] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(eq(schema.clients.slug, "hella"))
    .limit(1);
  if (!client) {
    console.log("  [FAIL] HELLA client not found — cannot run DB checks");
    failures++;
    return;
  }

  const TEST_CAMPAIGN = "__verify_auto_stage__";
  const campaignId = await ensureCampaignByName(client.id, TEST_CAMPAIGN);
  const { creatorId, partnershipId } = await createCreatorWithPartnership({
    clientId: client.id,
    name: "Verify Auto Stage Creator",
    links: ["https://www.instagram.com/__verify_as_test__"],
    campaignId,
    stage: "shortlisted",
  });

  try {
    // shortlisted --outbound--> contacted
    const r1 = await applyAutoStage(partnershipId, "outbound_message");
    check("outbound: shortlisted → contacted", r1?.from === "shortlisted" && r1?.to === "contacted");

    // contacted --outbound again--> no-op (guard holds)
    const r2 = await applyAutoStage(partnershipId, "outbound_message");
    check("second outbound is a no-op at contacted", r2 === null);

    // contacted --inbound--> in_conversation
    const r3 = await applyAutoStage(partnershipId, "inbound_message");
    check("inbound: contacted → in_conversation", r3?.to === "in_conversation");

    // in_conversation --deliverable--> no-op (not in allowlist)
    const r4 = await applyAutoStage(partnershipId, "deliverable_added");
    check("deliverable_added is a no-op at in_conversation", r4 === null);

    // Manually place at awaiting_address (a human judgment move), then address.
    await db
      .update(schema.cmPartnerships)
      .set({ stage: "awaiting_address" })
      .where(eq(schema.cmPartnerships.id, partnershipId));
    const r5 = await applyAutoStage(partnershipId, "address_complete");
    check("address_complete: awaiting_address → fulfilling", r5?.to === "fulfilling");

    const r6 = await applyAutoStage(partnershipId, "shipment_delivered");
    check("shipment_delivered: fulfilling → content_pending", r6?.to === "content_pending");

    const r7 = await applyAutoStage(partnershipId, "deliverable_added");
    check("deliverable_added: content_pending → posted", r7?.to === "posted");

    // Audit trail: every applied transition wrote a cm_stage_transitions row.
    const transitions = await db
      .select({
        fromStage: schema.cmStageTransitions.fromStage,
        toStage: schema.cmStageTransitions.toStage,
      })
      .from(schema.cmStageTransitions)
      .where(eq(schema.cmStageTransitions.partnershipId, partnershipId))
      .orderBy(asc(schema.cmStageTransitions.changedAt));
    const autoOnes = transitions.filter((t) => t.fromStage !== null);
    check(
      "5 audit rows for the 5 applied transitions",
      autoOnes.filter((t) =>
        ["contacted", "in_conversation", "fulfilling", "content_pending", "posted"].includes(
          t.toStage,
        ),
      ).length >= 5,
      JSON.stringify(transitions),
    );

    const missing = await applyAutoStage("00000000-0000-0000-0000-000000000000", "outbound_message");
    check("unknown partnership returns null, not a throw", missing === null);

    // The reopen path: auto-closed creator replies late.
    await db
      .update(schema.cmPartnerships)
      .set({ stage: "no_response" })
      .where(eq(schema.cmPartnerships.id, partnershipId));
    const reopened = await applyAutoStage(partnershipId, "inbound_message");
    check("late reply reopens no_response → in_conversation", reopened?.from === "no_response" && reopened?.to === "in_conversation");
    const notReopened = await applyAutoStage(partnershipId, "outbound_message");
    check("our own outbound never advances in_conversation", notReopened === null);
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
