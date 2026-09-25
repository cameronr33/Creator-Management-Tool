/**
 * Verifies the "Next:" line on a creator's record and the stage vocabulary
 * the UI is built from.
 *
 *   npm run verify:next-step
 *
 * Pure — no database. Every stage must produce a next step; closed stages
 * must name who ended it; the stage tables the Help page renders must be
 * complete and consistent with the auto-stage engine.
 */
import { nextStep, type NextStepInput } from "../src/lib/next-step";
import { STAGES, STAGE_ACTIONS, STAGE_GROUP_LABELS, stagesByGroup, AUTO_TRIGGER_LABELS, EXIT_REASONS_BY_STAGE, stageLabel } from "../src/lib/stages";
import { AUTO_STAGE_RULES, type AutoStageTrigger } from "../src/lib/auto-stage";
import { channelLabel } from "../src/lib/outreach";
import type { CmStage } from "../src/lib/db/schema";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const base: NextStepInput = {
  stage: "shortlisted",
  hasAddress: false,
  shipmentStatus: null,
  hasBrief: false,
  briefSent: false,
  deliverables: 0,
  hasReplied: false,
  totalOutbound: 0,
  followUpCount: 0,
  daysSinceLastOutbound: null,
  datesAreMigrated: false,
  exitReason: null,
};

function main() {
  console.log("\n── nextStep: every stage answers 'what now?' ──");
  for (const s of STAGES) {
    const step = nextStep({ ...base, stage: s.value });
    check(`${s.value} → non-empty next step`, step.text.trim().length > 10, step.text);
  }

  console.log("\n── nextStep: the facts the stage summarises change the answer ──");
  check(
    "a reply alone never implies positive interest",
    !/they're interested/i.test(nextStep({ ...base, stage: "in_conversation", hasReplied: true }).text),
  );
  check("a returned shipment overrides a later content stage", nextStep({ ...base, stage: "content_pending", briefSent: true, shipmentStatus: "returned" }).anchor === "shipping");
  check(
    "fulfilling with no shipment says to create one",
    /create the shipment/i.test(nextStep({ ...base, stage: "fulfilling" }).text),
  );
  check(
    "fulfilling + shipped says to mark delivered",
    /mark delivered/i.test(nextStep({ ...base, stage: "fulfilling", shipmentStatus: "shipped" }).text),
  );
  check(
    "Shipped says to mark it delivered when it lands",
    /mark delivered/i.test(nextStep({ ...base, stage: "shipped", shipmentStatus: "shipped" }).text),
  );
  check(
    "fulfilling + delivered + brief not sent says to send the brief",
    /send the brief/i.test(nextStep({ ...base, stage: "fulfilling", shipmentStatus: "delivered" }).text),
  );
  check(
    "contacted after 6 days names the wait",
    /6d ago/.test(nextStep({ ...base, stage: "contacted", totalOutbound: 1, daysSinceLastOutbound: 6 }).text),
  );
  check(
    "contacted + migrated rows never invent a clock",
    /imported/i.test(nextStep({ ...base, stage: "contacted", totalOutbound: 1, datesAreMigrated: true, daysSinceLastOutbound: 400 }).text),
  );
  check(
    "Agreed with an address points to Ready to ship, not the address",
    /ready to ship/i.test(nextStep({ ...base, stage: "awaiting_address", hasAddress: true }).text),
  );
  check(
    "Agreed without an address asks for it",
    /address/i.test(nextStep({ ...base, stage: "awaiting_address" }).text),
  );
  check(
    "Finalizing says what's still missing — the signed contract, the address, or both",
    /signed contract and their shipping address/.test(nextStep({ ...base, stage: "finalizing" }).text) &&
      /Still needed: their shipping address/.test(nextStep({ ...base, stage: "finalizing", signed: true }).text) &&
      /move them to Ready to ship/.test(nextStep({ ...base, stage: "finalizing", signed: true, hasAddress: true }).text),
  );
  check(
    "a retired stage is answered as the stage it now means",
    nextStep({ ...base, stage: "negotiating" }).text === nextStep({ ...base, stage: "in_conversation" }).text,
  );
  check(
    "posted with no recorded video flags the gap",
    /no video recorded/i.test(nextStep({ ...base, stage: "posted", deliverables: 0 }).text),
  );
  const closed = nextStep({ ...base, stage: "declined", exitReason: "not_interested" });
  check("closed stages say who ended it and why", /they declined/i.test(closed.text) && /not interested/i.test(closed.text), closed.text);
  // Regression: this used to point at the Agreement card, but the reason is
  // chosen in the stage control.
  check(
    "closed without a reason asks for one (anchors to the stage control)",
    nextStep({ ...base, stage: "passed" }).anchor === "stage",
  );
  check("no_response mentions the reopen", /reopens/i.test(nextStep({ ...base, stage: "no_response" }).text));

  console.log("\n── stage vocabulary the UI and Help page are built from ──");
  const grouped = stagesByGroup();
  check(
    "stagesByGroup covers every stage exactly once",
    grouped.flatMap((g) => g.stages).length === STAGES.length &&
      new Set(grouped.flatMap((g) => g.stages.map((s) => s.value))).size === STAGES.length,
  );
  check("every group has a label", grouped.every((g) => STAGE_GROUP_LABELS[g.group].length > 0));
  check("every stage has a hint a newcomer can read", STAGES.every((s) => s.hint.length >= 20));
  check("every stage says what to do there", STAGES.every((s) => s.action.length >= 20 && STAGE_ACTIONS[s.value] === s.action));
  check(
    "closed stage labels say who ended it",
    stageLabel("passed").startsWith("We") && stageLabel("declined").startsWith("They"),
  );
  check(
    "every closed stage has exit reasons",
    (["passed", "declined", "no_response"] as CmStage[]).every((s) => (EXIT_REASONS_BY_STAGE[s]?.length ?? 0) > 0),
  );
  check(
    "retired stages read as the stage they became",
    stageLabel("negotiating") === "Talking" && stageLabel("researched") === "To contact" && stageLabel("completed") === "Posted",
  );
  const triggers = Object.keys(AUTO_STAGE_RULES) as AutoStageTrigger[];
  check("every auto-stage trigger has a plain-language label", triggers.every((t) => AUTO_TRIGGER_LABELS[t]?.length > 10));
  check(
    "every auto-stage target stage exists in the vocabulary",
    triggers.every((t) => STAGES.some((s) => s.value === AUTO_STAGE_RULES[t].to)),
  );
  check("channel labels are plain", channelLabel("ig_dm") === "Instagram DM" && channelLabel("phone") === "Phone");
}

main();
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
