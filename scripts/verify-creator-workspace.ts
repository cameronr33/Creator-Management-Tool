/** Pure regressions for the creator workspace. Never opens a database. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CREATOR_SECTIONS, creatorSection, creatorSectionHref, safeCreatorReturnTo, shipmentAttentionStatus, shipmentSummary, timelineSource } from "../src/lib/creator-workspace";

const detailPage = readFileSync(join(__dirname, "../src/app/(app)/creators/[id]/page.tsx"), "utf8");

// A delivered record previously disappeared whenever a newer ready record
// occupied index zero, while the dashboard still counted both records.
assert.ok(!/shipments\[0\]/.test(detailPage), "Creator detail must not discard every shipment after the first");
// A bookmarked record for another client must not display the cookie's client
// or load that client's outreach template into this creator's conversation.
assert.ok(!detailPage.includes("getSelectedClientSlug"), "Creator detail must use the record's client, not the selected-client cookie");
assert.ok(detailPage.includes("shipments.map((shipment"), "Shipping must expose controls for every returned shipment");

const mixed = [{ status: "delivered" }, { status: "ready" }];
assert.equal(shipmentAttentionStatus(mixed), "ready", "An unfinished parcel must not be hidden by a delivered parcel");
assert.equal(shipmentAttentionStatus([...mixed].reverse()), "ready", "Shipment attention cannot depend on database ordering");
assert.equal(shipmentSummary(mixed), "1 ready · 1 delivered", "The summary must represent every parcel's status");
assert.equal(shipmentAttentionStatus([{ status: "shipped" }, { status: "returned" }]), "returned");
assert.equal(shipmentAttentionStatus([]), null);
assert.equal(shipmentSummary([]), "No shipment recorded");
assert.equal(creatorSection("invalid"), "overview");
assert.equal(creatorSection(["shipping", "profile"]), "overview");
assert.equal(safeCreatorReturnTo("/?view=waiting"), "/?view=waiting");
assert.equal(safeCreatorReturnTo("/creators?q=Maya&campaign=spring"), "/creators?q=Maya&campaign=spring");
for (const unsafe of ["https://attacker.test/", "//attacker.test/", "/\\attacker.test/", "/settings", "/creators#other", "javascript:alert(1)", "/creators\n", ["/", "/settings"]]) {
  assert.equal(safeCreatorReturnTo(unsafe), "/creators", "Return link must stay within the Today or creator-list view");
}
assert.equal(new URL(creatorSectionHref("record", "shipping", "/creators?q=Maya"), "https://example.test").searchParams.get("returnTo"), "/creators?q=Maya", "Section changes must preserve list context");
for (const section of CREATOR_SECTIONS) {
  assert.equal(creatorSection(section.value), section.value);
  const url = new URL(creatorSectionHref("record", section.value), "https://example.test");
  assert.equal(url.searchParams.get("tab"), section.value);
  assert.equal(url.hash, `#${section.value}`);
}
assert.equal(timelineSource({ isMigrated: true, channel: "email", externalId: "legacy" }), "Imported from sheet");
assert.equal(timelineSource({ isMigrated: false, channel: "email", externalId: "message" }), "Synced email");
assert.equal(timelineSource({ isMigrated: false, channel: "email", externalId: null }), "Manually logged");

console.log("PASS creator workspace regressions: multiple shipments, client context, section URLs, and evidence labels");
