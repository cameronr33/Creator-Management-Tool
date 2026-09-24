/**
 * Verifies the stage rules and the one stage-move core.
 *
 *   npm run preview:verify -- scripts/verify-auto-stage.ts
 *
 * Part 1 asserts the FULL pure rule matrix — every trigger × every stage,
 * retired values included — so any change to the rule table must be made
 * deliberately here too (frozen node 2).
 * Part 2 walks a live partnership through the trigger chain and the manual
 * guards against the database using throwaway __verify_ rows, asserting the
 * cm_stage_transitions audit rows and the shipment / video records each move
 * must leave behind, then cleans up everything it created.
 */
import { eq, asc } from "drizzle-orm";
import { db, schema } from "./db";
import { nextStageFor, applyAutoStage, AUTO_STAGE_RULES, type AutoStageTrigger } from "../src/lib/auto-stage";
import { moveStage, resolveTarget, describeVideo } from "../src/lib/stage-moves";
import { changeStage } from "../src/lib/mutations";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";
import { RETIRED_STAGES, STAGE_VALUES, canonicalStage, isTerminal, stageIndex } from "../src/lib/stages";
import type { CmStage } from "../src/lib/db/schema";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const ALL_STAGES = schema.cmStageEnum.enumValues;
const TRIGGERS = Object.keys(AUTO_STAGE_RULES) as AutoStageTrigger[];

/** The expected rule table, restated independently of the implementation. */
const EXPECTED: Record<AutoStageTrigger, { from: CmStage[]; to: CmStage }> = {
  outbound_message: { from: ["shortlisted"], to: "contacted" },
  // no_response is the one closed stage a creator's OWN reply reopens.
  inbound_message: { from: ["contacted", "no_response"], to: "in_conversation" },
  address_complete: { from: ["awaiting_address"], to: "fulfilling" },
  shipment_shipped: { from: ["awaiting_address", "fulfilling"], to: "shipped" },
  shipment_delivered: { from: ["awaiting_address", "fulfilling", "shipped"], to: "content_pending" },
  deliverable_added: { from: ["fulfilling", "shipped", "content_pending"], to: "posted" },
};

async function main() {
  console.log("\n── Pure rule matrix (every trigger × every stored stage) ──");
  const before = failures;
  check("the engine has exactly the expected triggers", TRIGGERS.sort().join() === Object.keys(EXPECTED).sort().join());
  for (const trigger of Object.keys(EXPECTED) as AutoStageTrigger[]) {
    const rule = EXPECTED[trigger];
    for (const stage of ALL_STAGES) {
      const expected = rule.from.includes(stage) ? rule.to : null;
      const actual = nextStageFor(stage, trigger);
      if (actual !== expected) check(`${trigger} @ ${stage}`, false, `expected ${expected}, got ${actual}`);
    }
  }
  const matrixSize = Object.keys(EXPECTED).length * ALL_STAGES.length;
  check(`full ${matrixSize}-cell matrix matches the expected rule table`, failures === before);
  check(
    "retired stage values are never a from- or to-stage",
    Object.keys(RETIRED_STAGES).every((r) => TRIGGERS.every((t) => !AUTO_STAGE_RULES[t].from.includes(r as CmStage) && AUTO_STAGE_RULES[t].to !== r)),
  );
  check("no rule ever closes a deal", TRIGGERS.every((t) => !isTerminal(AUTO_STAGE_RULES[t].to)));
  check("no rule decides Agreed — that is a person's (or the creator's email's) call", TRIGGERS.every((t) => AUTO_STAGE_RULES[t].to !== "awaiting_address"));
  check(
    "passed/declined are never advanced by any trigger",
    (["passed", "declined"] as CmStage[]).every((s) => TRIGGERS.every((t) => nextStageFor(s, t) === null)),
  );
  check(
    "no_response reopens ONLY on the creator's own reply",
    nextStageFor("no_response", "inbound_message") === "in_conversation" &&
      TRIGGERS.filter((t) => t !== "inbound_message").every((t) => nextStageFor("no_response", t) === null),
  );
  check(
    "no rule moves an ACTIVE stage backward",
    TRIGGERS.every((t) => AUTO_STAGE_RULES[t].from.filter((f) => !isTerminal(f)).every((f) => stageIndex(AUTO_STAGE_RULES[t].to) > stageIndex(f))),
  );
  // Owner decisions: 7 active on 2026-09-22; Shipping split into Ready to ship → Shipped on 2026-09-23.
  check("canonical stages are exactly 8 active + 3 closed", STAGE_VALUES.length === 11 && STAGE_VALUES.filter((s) => !isTerminal(s)).length === 8);
  check(
    "every retired value maps to a current stage",
    Object.entries(RETIRED_STAGES).every(([, to]) => STAGE_VALUES.includes(to as CmStage)) && canonicalStage("negotiating") === "in_conversation",
  );

  console.log("\n── Pure: where a move lands ──");
  check("Agreed with a complete address continues to Ready to ship", JSON.stringify(resolveTarget("awaiting_address", { addressComplete: true })) === JSON.stringify({ to: "fulfilling", continued: true }));
  check("Agreed without an address stays Agreed", resolveTarget("awaiting_address", { addressComplete: false }).to === "awaiting_address");
  check("a retired target is canonicalised", resolveTarget("negotiating", { addressComplete: false }).to === "in_conversation");
  check("video platform from the link", describeVideo("https://www.instagram.com/reel/ABC123/").platform === "instagram" && describeVideo("https://www.tiktok.com/@a/video/1").platform === "tiktok" && describeVideo("https://youtu.be/x").platform === "youtube");
  check("the pasted link is stored as pasted", describeVideo("https://www.instagram.com/reel/ABC123/?igsh=x").url === "https://www.instagram.com/reel/ABC123/?igsh=x");
  check("instagram shortcode captured", describeVideo("https://www.instagram.com/reel/ABC123/").shortcode === "ABC123");

  console.log("\n── Live lifecycle (throwaway rows, cleaned up after) ──");
  const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.slug, "hella")).limit(1);
  if (!client) {
    console.log("  [FAIL] HELLA client not found — cannot run DB checks");
    failures++;
    return;
  }

  const TEST_CAMPAIGN = "__verify_auto_stage__";
  const campaignId = await ensureCampaignByName(client.id, TEST_CAMPAIGN);
  const made: string[] = [];
  const add = async (handle: string) => {
    const r = await createCreatorWithPartnership({ clientId: client.id, name: `Verify ${handle}`, links: [`https://www.instagram.com/${handle}`], campaignId, stage: "shortlisted" });
    made.push(r.creatorId);
    return r.partnershipId;
  };
  const shipments = async (pid: string) => db.select().from(schema.cmShipments).where(eq(schema.cmShipments.partnershipId, pid));
  const stageOf = async (pid: string) => (await db.select({ s: schema.cmPartnerships.stage }).from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, pid)))[0]?.s;

  try {
    const pid = await add("__verify_as_chain__");
    const r1 = await applyAutoStage(pid, "outbound_message");
    check("outbound: To contact → Contacted", r1?.from === "shortlisted" && r1?.to === "contacted");
    check("second outbound is a no-op at Contacted", (await applyAutoStage(pid, "outbound_message")) === null);
    const r3 = await applyAutoStage(pid, "inbound_message");
    check("inbound: Contacted → Talking", r3?.to === "in_conversation");
    check("deliverable_added is a no-op at Talking", (await applyAutoStage(pid, "deliverable_added")) === null);

    const agreed = await changeStage(pid, "awaiting_address");
    check("a person moves Talking → Agreed", agreed.status === "moved" && agreed.to === "awaiting_address");
    check("no shipment is created before Ready to ship", (await shipments(pid)).length === 0);

    const r5 = await applyAutoStage(pid, "address_complete");
    check("address_complete: Agreed → Ready to ship", r5?.to === "fulfilling");
    const created = await shipments(pid);
    check("entering Ready to ship created exactly one ready shipment", created.length === 1 && created[0].status === "ready");

    const r5b = await applyAutoStage(pid, "shipment_shipped");
    check("shipment_shipped: Ready to ship → Shipped", r5b?.to === "shipped");
    const r6 = await applyAutoStage(pid, "shipment_delivered");
    check("shipment_delivered: Shipped → Waiting on video", r6?.to === "content_pending");
    check("the existing shipment is reused, not duplicated", (await shipments(pid)).length === 1);

    const noVideo = await changeStage(pid, "posted");
    check("a manual move to Posted without a video is refused", noVideo.status === "needs_video" && (await stageOf(pid)) === "content_pending");
    const withVideo = await changeStage(pid, "posted", undefined, { videoUrl: "https://www.instagram.com/reel/VERIFY1/" });
    check("…and applied once the link is given", withVideo.status === "moved" && withVideo.to === "posted" && !!withVideo.createdDeliverableId);
    const vids = await db.select().from(schema.cmDeliverables).where(eq(schema.cmDeliverables.partnershipId, pid));
    check("the video record holds the pasted link", vids.length === 1 && vids[0].url === "https://www.instagram.com/reel/VERIFY1/" && vids[0].shortcode === "VERIFY1");

    const transitions = await db
      .select()
      .from(schema.cmStageTransitions)
      .where(eq(schema.cmStageTransitions.partnershipId, pid))
      .orderBy(asc(schema.cmStageTransitions.changedAt));
    const bySource = (s: string) => transitions.filter((t) => t.source === s).map((t) => t.toStage);
    check("rule moves are recorded as source=rule with the trigger", JSON.stringify(bySource("rule")) === JSON.stringify(["contacted", "in_conversation", "fulfilling", "shipped", "content_pending"]), JSON.stringify(transitions.map((t) => [t.source, t.toStage])));
    check("person moves are recorded as source=manual", JSON.stringify(bySource("manual")) === JSON.stringify(["shortlisted", "awaiting_address", "posted"]));
    const shipMove = transitions.find((t) => t.toStage === "fulfilling");
    check("the move that created a shipment remembers it (for Undo)", (shipMove?.meta as { createdShipmentId?: string } | null)?.createdShipmentId === created[0].id);
    check("rule transitions keep which trigger fired", (shipMove?.meta as { trigger?: string } | null)?.trigger === "address_complete");

    // Existing shipment records — duplicates included — are never touched.
    const pid2 = await add("__verify_as_dupes__");
    await db.insert(schema.cmShipments).values([{ partnershipId: pid2, status: "ready" }, { partnershipId: pid2, status: "shipped" }]);
    const toShip = await changeStage(pid2, "fulfilling");
    check("moving to Ready to ship with shipments already there adds none", toShip.status === "moved" && !toShip.createdShipmentId && (await shipments(pid2)).length === 2);

    // Agreed with the address already on file continues to Ready to ship.
    const pid3 = await add("__verify_as_address__");
    await db.update(schema.cmPartnerships).set({ addressLine1: "1 Test St", city: "Testville", region: "CA", postalCode: "90000" }).where(eq(schema.cmPartnerships.id, pid3));
    const cont = await changeStage(pid3, "awaiting_address");
    check("Agreed with an address on file lands on Ready to ship", cont.status === "moved" && cont.to === "fulfilling" && cont.continued);
    check("…and has its shipment", (await shipments(pid3)).length === 1);

    // Compare-and-set: an engine that evaluated a stale stage does nothing.
    const stale = await moveStage({ partnershipId: pid3, to: "content_pending", source: "rule", expectFrom: "contacted" });
    check("a stale engine move is refused", stale.status === "stale" && (await stageOf(pid3)) === "fulfilling");

    // A person moving a card to Shipped means it went out: the ready shipment follows.
    const sent = await changeStage(pid3, "shipped");
    const [afterSent] = await shipments(pid3);
    check("a person's move to Shipped marks the ready shipment shipped", sent.status === "moved" && afterSent?.status === "shipped" && !!afterSent.shippedAt, JSON.stringify(afterSent));
    check("…and still adds no second shipment", (await shipments(pid3)).length === 1);
    // Review finding (2026-09-24): a misclick to Shipped and back left an invented ship date.
    await changeStage(pid3, "fulfilling");
    const [backAgain] = await shipments(pid3);
    check("moving back from Shipped to Ready to ship puts the shipment back, with no ship date", backAgain?.status === "ready" && backAgain.shippedAt === null, JSON.stringify(backAgain));
    await changeStage(pid3, "shipped");

    // Closing records why; reopening to an active stage clears it.
    await changeStage(pid3, "declined", undefined, { exitReason: "not_interested" });
    const [closed] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, pid3));
    check("closing records the reason", closed.stage === "declined" && closed.exitReason === "not_interested");
    await changeStage(pid3, "in_conversation");
    const [reopened] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, pid3));
    check("reopening clears the stale reason", reopened.stage === "in_conversation" && reopened.exitReason === null);

    // The reopen path.
    await changeStage(pid3, "no_response");
    const late = await applyAutoStage(pid3, "inbound_message");
    check("a reply reopens No response → Talking", late?.from === "no_response" && late?.to === "in_conversation");
    check("our own message never advances Talking", (await applyAutoStage(pid3, "outbound_message")) === null);

    check("unknown partnership returns null, not a throw", (await applyAutoStage("00000000-0000-0000-0000-000000000000", "outbound_message")) === null);
  } finally {
    for (const id of made) await db.delete(schema.cmCreators).where(eq(schema.cmCreators.id, id));
    await db.delete(schema.cmCampaigns).where(eq(schema.cmCampaigns.id, campaignId));
  }
  const leftover = await db.select({ id: schema.cmCampaigns.id }).from(schema.cmCampaigns).where(eq(schema.cmCampaigns.id, campaignId));
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
