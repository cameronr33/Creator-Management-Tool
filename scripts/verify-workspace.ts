import assert from "node:assert/strict";
import { clearCreatorFilters, deriveWorkspaceItem, type WorkspaceFacts } from "../src/lib/workspace";
import { deriveOutreachState, DEFAULT_THRESHOLDS } from "../src/lib/outreach";
import { searchDraft, type SearchDraft } from "../src/lib/search-draft";

const base: WorkspaceFacts = {
  partnershipId: "p1", creatorId: "c1", name: "Test creator", username: "test",
  campaignId: "campaign", campaignName: "Test campaign", profileUrl: "https://example.com",
  contentPillar: null, followers: null, avgViews: null, viewsSource: null, businessEmail: null,
  stage: "awaiting_address", agreementType: "verbal", hasAddress: false, hasBrief: false,
  briefSent: false, exitReason: null, shipments: [], deliverables: 0,
  outreach: deriveOutreachState([]), thresholds: DEFAULT_THRESHOLDS,
};
assert.equal(clearCreatorFilters("view=research&q=Maya&stage=contacted&campaign=campaign"), "view=research");
let draft: SearchDraft = { draft: "", url: "", pending: [] };
draft = searchDraft(draft, { type: "edit", value: "Ma" });
draft = searchDraft(draft, { type: "submit", value: "Ma" });
draft = searchDraft(draft, { type: "edit", value: "Maya" });
draft = searchDraft(draft, { type: "url", value: "Ma" });
assert.equal(draft.draft, "Maya", "a slow response cannot erase newer typing");
draft = searchDraft(draft, { type: "url", value: "" });
assert.equal(draft.draft, "", "browser back restores the URL search");

// A ready row without a complete address must never invite a one-click shipment.
const missingAddress = deriveWorkspaceItem({ ...base, shipments: [{ status: "ready" }] });
assert.equal(missingAddress.lane, "review");
assert.notEqual(missingAddress.action, "Ship product");
// The original dashboard surfaced the same partnership in three separate queues.
const conflicting = deriveWorkspaceItem({ ...base, shipments: [{ status: "ready" }, { status: "delivered" }] });
assert.equal(conflicting.lane, "review");
assert.match(conflicting.shipping, /2 records/);
assert.ok(conflicting.issues.length > 0);
// An import timestamp cannot become a fabricated overdue clock.
const imported = deriveWorkspaceItem({ ...base, stage: "contacted", outreach: {
  ...base.outreach, totalOutbound: 1, datesAreMigrated: true, daysSinceLastOutbound: 400,
  lastContactAt: new Date("2025-01-01"), lastOutboundAt: new Date("2025-01-01"),
} });
assert.equal(imported.lane, "review");
assert.equal(imported.lastContact, "Imported · date unknown");
assert.equal(imported.dueLabel, null);
// A historical reply never hides an active conversation from the daily list.
assert.equal(deriveWorkspaceItem({ ...base, stage: "in_conversation", outreach: { ...base.outreach, hasReplied: true } }).lane, "action");
// One published item must not imply that all promised content is complete.
const published = deriveWorkspaceItem({ ...base, stage: "posted", deliverables: 1, hasAddress: true, shipments: [{ status: "delivered" }] });
assert.equal(published.lane, "action");
assert.match(published.content, /1 published/);
assert.match(published.action, /Review/);
// Closed partnerships with outstanding shipment facts remain closed in the worklist.
assert.equal(deriveWorkspaceItem({ ...base, stage: "declined", shipments: [{ status: "ready" }] }).lane, "closed");
// Follow-up thresholds are client-specific, not an arbitrary new UI clock.
const contacted = { ...base, stage: "contacted" as const, outreach: { ...base.outreach, totalOutbound: 1, daysSinceLastOutbound: 6 } };
assert.equal(deriveWorkspaceItem(contacted).lane, "action");
assert.equal(deriveWorkspaceItem({ ...contacted, thresholds: { ...DEFAULT_THRESHOLDS, followUp1AfterDays: 9 } }).lane, "waiting");
assert.equal(deriveWorkspaceItem({ ...base, stage: "completed" }).lane, "closed");
// Shipment corrections must resurface work even though automatic stages never move backward.
for (const stage of ["content_pending", "posted"] as const) {
  for (const status of ["ready", "returned"]) {
    const reship = deriveWorkspaceItem({ ...base, stage, hasAddress: true, briefSent: true, deliverables: 1, shipments: [{ status }] });
    assert.equal(reship.lane, "action", `${stage}/${status} must resurface shipping work`);
    assert.equal(reship.tab, "shipping");
  }
}
console.log("PASS: workspace handles contradictions, imports, outstanding content, terminal states, and client cadence.");
