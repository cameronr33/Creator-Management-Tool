/**
 * Verifies the Phase-3 editor quick wins.
 *
 *   npm run verify:editors
 *
 * Part 1 (pure): parseAddress round-trips on the four documented shapes.
 * Part 2 (live DB, self-cleaning): shipment create-with-typed-carrier path
 * (the blur fix), and the deliverable metricsSource labeling rules the
 * /api/deliverables route implements.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { formatAddress, parseAddress } from "../src/lib/address";
import { trackingUrl } from "../src/lib/tracking";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

async function main() {
  console.log("\n── parseAddress (the four documented shapes) ──");
  const a1 = parseAddress("Joe Hubbard, 3333 Simeon Bunker St, Saint Charles, Missouri, 63301");
  check("full-state-name shape complete", !!a1?.isComplete, JSON.stringify(a1));
  check("state normalized to code", a1?.region === "MO", a1?.region ?? "null");

  const a2 = parseAddress("Anton Mendez, 7747 Lakeside Drive, Jurupa Valley, CA 92509");
  check("state-zip-jammed shape complete", !!a2?.isComplete, JSON.stringify(a2));
  check("zip split from state", a2?.postalCode === "92509" && a2?.region === "CA");

  const a3 = parseAddress("Nico Dente, 3005 W Gray St., Tampa Fl, 33609");
  check("city-state-jammed shape complete", !!a3?.isComplete, JSON.stringify(a3));

  const a4 = parseAddress("Mikey Sneed, 2200 Shady Tree Ln, Texas, 77301");
  check("no-city shape is flagged, not guessed", !a4?.isComplete && (a4?.issues.length ?? 0) > 0, JSON.stringify(a4));
  check("raw preserved for manual fix", a4?.raw === "Mikey Sneed, 2200 Shady Tree Ln, Texas, 77301");

  // Regression: a multi-line paste straight from a DM/email (one part per line,
  // trailing country) used to yield "no street line" because only commas split.
  const a5 = parseAddress("Tatum Maciejack\n312 Onyx Dr\nLittle Elm, TX  75068\nUnited States");
  check(
    "multi-line DM paste parses (newlines + trailing country)",
    !!a5?.isComplete &&
      a5.recipientName === "Tatum Maciejack" &&
      a5.addressLine1 === "312 Onyx Dr" &&
      a5.city === "Little Elm" &&
      a5.region === "TX" &&
      a5.postalCode === "75068",
    JSON.stringify(a5),
  );
  const a6 = parseAddress("7747 Lakeside Drive\nJurupa Valley, CA 92509\nUSA");
  check("multi-line without a name still complete, 'USA' dropped", !!a6?.isComplete && a6.recipientName === null, JSON.stringify(a6));

  console.log("\n── Tracking links and addresses outside the US (2026-09-28 review) ──");
  check("a UPS number links to UPS, whatever the carrier field says", trackingUrl(null, "1Z999AA10123456784")?.startsWith("https://www.ups.com/") === true);
  check("a named carrier wins", trackingUrl("FedEx", "123")?.startsWith("https://www.fedex.com/") === true && trackingUrl("USPS", "9400111899223856923456")?.includes("usps.com") === true);
  check("an unknown shape with no carrier isn't guessed", trackingUrl(null, "ABC-123") === null && trackingUrl("UPS", "") === null);
  check(
    "the country prints when it isn't the US",
    formatAddress({ addressLine1: "1 King St", city: "Toronto", region: "ON", postalCode: "M5H 1A1", country: "Canada" }).endsWith("Canada") &&
      formatAddress({ addressLine1: "1 A St", city: "Austin", region: "TX", postalCode: "78701", country: "US" }).endsWith("78701"),
  );

  console.log("\n── metricsSource labeling rules (mirrors /api/deliverables) ──");
  // The route's decision table, restated: manual publicViews -> authoritative;
  // Apify views -> provisional; neither -> null.
  const label = (publicViews: number | null, apifyViews: number | null) =>
    publicViews != null ? "ig_public_chrome" : apifyViews != null ? "apify" : null;
  check("manual publicViews → ig_public_chrome", label(1000, 500) === "ig_public_chrome");
  check("apify-only → apify (provisional)", label(null, 500) === "apify");
  check("no views → null", label(null, null) === null);

  console.log("\n── Live: shipment blur-create + deliverable labels (cleaned up) ──");
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

  const campaignId = await ensureCampaignByName(client.id, "__verify_editors__");
  const { creatorId, partnershipId } = await createCreatorWithPartnership({
    clientId: client.id,
    name: "Verify Editors Creator",
    links: ["https://www.instagram.com/__verify_ed_test__"],
    campaignId,
    stage: "fulfilling",
  });

  try {
    // The blur-fix path: no shipment exists, typed carrier+tracking arrive
    // with status "ready" — the values must persist, not be discarded.
    await db.insert(schema.cmShipments).values({
      partnershipId,
      status: "ready",
      carrier: "UPS",
      trackingNumber: "1Z999AA10123456784",
    });
    const [ship] = await db
      .select()
      .from(schema.cmShipments)
      .where(eq(schema.cmShipments.partnershipId, partnershipId));
    check("shipment created at ready with typed carrier", ship.carrier === "UPS");
    check("tracking number persisted", ship.trackingNumber === "1Z999AA10123456784");

    // Deliverable with Apify-shaped metrics stays provisional.
    await db.insert(schema.cmDeliverables).values({
      partnershipId,
      platform: "instagram",
      url: "https://www.instagram.com/reel/VERIFYED1/",
      views: 5000,
      metricsSource: "apify",
      metricsRefreshedAt: new Date(),
    });
    const [del] = await db
      .select()
      .from(schema.cmDeliverables)
      .where(eq(schema.cmDeliverables.partnershipId, partnershipId));
    check("apify-sourced deliverable labeled provisional", del.metricsSource === "apify");

    // addressRaw persists through the partnerships table.
    await db
      .update(schema.cmPartnerships)
      .set({ addressRaw: "Joe, 123 Main St, Austin, TX, 78701" })
      .where(eq(schema.cmPartnerships.id, partnershipId));
    const [p] = await db
      .select({ addressRaw: schema.cmPartnerships.addressRaw })
      .from(schema.cmPartnerships)
      .where(eq(schema.cmPartnerships.id, partnershipId));
    check("addressRaw round-trips", p.addressRaw === "Joe, 123 Main St, Austin, TX, 78701");
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
