/**
 * Offline verification of the HELLA import logic. Runs the pure transformation
 * against the real CSVs and asserts the migration-fidelity criteria from the
 * plan — no database required.
 *
 *   npx tsx scripts/verify-import.ts
 *
 * Exit code 0 = all assertions pass. This is the deterministic gate the build
 * loop stops on.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { buildImportPlan, type ImportRecord } from "../src/lib/hella-import";
import { CM_STAGE_ORDER } from "../src/lib/db/schema";

const DOWNLOADS = "C:/Users/camer/Downloads";
const plan = buildImportPlan(
  readFileSync(resolve(DOWNLOADS, "HELLA Creator Tracker - HELLA Creator Tracker.csv"), "utf8"),
  readFileSync(resolve(DOWNLOADS, "HELLA Affiliate Shipping Details - Sheet1.csv"), "utf8"),
);

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`  [${mark}] ${label}${detail && !cond ? ` — ${detail}` : ""}`);
}

const byUser = (u: string): ImportRecord | undefined =>
  plan.records.find((r) => r.username === u.toLowerCase());

const ALL_STAGES = new Set<string>([...CM_STAGE_ORDER, "passed", "declined", "no_response"]);

console.log("\n── Counts ──");
check("32 tracker creators imported", plan.records.length === 32, `got ${plan.records.length}`);
check("11 shipping records seen", plan.shippingCount === 11, `got ${plan.shippingCount}`);
check("no record dropped (0 shipping-only)", !plan.flags.some((f) => f.issue.includes("not the tracker")));

console.log("\n── Every stage is a valid enum value ──");
const badStages = plan.records.filter((r) => !ALL_STAGES.has(r.stage));
check("0 unmapped stage values", badStages.length === 0, badStages.map((r) => `${r.name}:${r.stage}`).join(", "));

console.log("\n── Spot-checks: the five cases that broke the old model ──");

const joe = byUser("mo_bronco");
check("Joe Hubbard exists", !!joe);
if (joe) {
  check("  → stage fulfilling", joe.stage === "fulfilling", joe.stage);
  check("  → agreementType signed", joe.agreementType === "signed", `${joe.agreementType}`);
  check("  → has a shipment (ready)", joe.needsShipment && joe.shipmentStatus === "ready", `${joe.shipmentStatus}`);
  check("  → address parsed to Saint Charles, MO", joe.address?.city === "Saint Charles" && joe.address?.region === "MO", `${joe.address?.city}, ${joe.address?.region}`);
}

const dey = byUser("wewrenchofficial");
check("Michael Dey exists", !!dey);
if (dey) {
  check("  → stage awaiting_address (verbal, no address)", dey.stage === "awaiting_address", dey.stage);
  check("  → appears in the conflict report", plan.conflicts.some((c) => c.creator.toLowerCase().includes("dey")), "not in conflicts");
}

const tbd = byUser("trailbossdad");
check("Trail Boss Dad exists", !!tbd);
if (tbd) {
  check("  → stage passed", tbd.stage === "passed", tbd.stage);
  check("  → exitReason NULL (unresolved, flagged)", tbd.exitReason === null, `${tbd.exitReason}`);
  check("  → flagged for manual pass/declined decision", plan.flags.some((f) => f.creator.toLowerCase().includes("trail")), "not flagged");
}

const garage = byUser("802garage");
check("802 Garage exists", !!garage);
if (garage) {
  check("  → stage negotiating", garage.stage === "negotiating", garage.stage);
  check("  → compensationType flat_fee", garage.compensationType === "flat_fee", garage.compensationType);
}

const nico = byUser("martini_944");
check("Nico exists", !!nico);
if (nico) {
  check("  → stage fulfilling (verbal + address)", nico.stage === "fulfilling", nico.stage);
  check("  → two products requested", nico.products.length === 2, `got ${nico.products.length}`);
}

console.log("\n── Awaiting-address bottleneck (6 of 7 verbal agreements) ──");
const verbals = plan.records.filter((r) => r.agreementType === "verbal");
const awaiting = verbals.filter((r) => r.stage === "awaiting_address");
check("≥6 verbal agreements sit in awaiting_address", awaiting.length >= 6, `got ${awaiting.length} of ${verbals.length}`);

console.log("\n── Stage-integrity invariants ──");
const fulfillingNoShip = plan.records.filter((r) => {
  const i = CM_STAGE_ORDER.indexOf(r.stage as (typeof CM_STAGE_ORDER)[number]);
  const fulfillingIdx = CM_STAGE_ORDER.indexOf("fulfilling");
  return i >= fulfillingIdx && i !== -1 && !r.needsShipment;
});
check("every stage ≥ fulfilling carries a shipment", fulfillingNoShip.length === 0, fulfillingNoShip.map((r) => r.name).join(", "));

const eric = byUser("erickendricks");
if (eric) check("Eric Kendricks → negotiating", eric.stage === "negotiating", eric.stage);

const autumn = byUser("autumn.schwalbe");
if (autumn) check("Autumn → wipers qty 10 parsed", autumn.products.some((p) => p.quantity === 10), `qty ${autumn.products.map((p) => p.quantity).join(",")}`);

console.log("\n── Data coercion sanity ──");
const arctic = byUser("arctic.mojave");
if (arctic) {
  check("Arctic Mojave followers = 50443", arctic.followers === 50443, `${arctic.followers}`);
  check("Arctic Mojave max views = 11.9M", arctic.maxViews === 11900000, `${arctic.maxViews}`);
  check("Arctic Mojave stage contacted", arctic.stage === "contacted", arctic.stage);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 1 - 1 : 1);
