/**
 * Verifies what the client portal can see and do.
 *
 *   npm run preview:verify -- scripts/verify-portal.ts
 *
 * The portal returns exactly the agreed fields — never email text or
 * summaries, fees, agreed terms or notes (asserted by planting them and
 * searching the output) — the address only while it's theirs to ship, and
 * nothing of another client. A client's shipment moves the stage through the
 * same rule as ours, with who did it recorded.
 *
 * Views and the shipping list (owner, 2026-09-28): each video's views go out
 * labelled — verified only for Instagram's public count, everything else
 * estimated — and the two totals never mix (frozen node 1). The shipping list
 * holds Ready-to-ship creators only, exactly its header, nothing private, and
 * no cell a spreadsheet would run as a formula.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { getPortalCreators, partnershipOfClient, PORTAL_CREATOR_KEYS, PORTAL_VIDEO_KEYS, viewsKindOf } from "../src/lib/portal-data";
import { SHIPPING_LIST_HEADER, csvCell, portalViewTotals, shippingListCsv } from "../src/lib/portal-export";
import { clientMayShip, recordShipment } from "../src/lib/shipments";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";
import { changeStage } from "../src/lib/mutations";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const SECRETS = ["SECRET_SUMMARY_7731", "SECRET_TERMS_7731", "SECRET_NOTE_7731", "SECRET_BODY_7731", "SECRET_CREATOR_NOTE_7731", "4242.00", "secret-creator@example.test", "SECRET_CONTRACT_7731", "SECRET_EMAIL_DEAL_7731", "SECRET_STATUS_NOTE_7731", "SECRET_ARCHIVE_7731", "SECRET_STAGE_QUOTE_7731", "SECRET_PROMISE_7731", "SECRET_PROMISE_QUOTE_7731"];

async function main() {
  const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.slug, "hella")).limit(1);
  const NONE = "00000000-0000-0000-0000-000000000000";
  let other = { id: NONE };
  let campaignId = NONE;
  let otherCampaign = NONE;
  const creatorIds: string[] = [];
  let ownerMemberId: string | null = null;
  try {
    [other] = await db.insert(schema.clients).values({ name: "__verify_po_other", slug: `__verify_po_${Date.now()}` }).returning();
    campaignId = await ensureCampaignByName(client.id, "__verify_portal__");
    otherCampaign = await ensureCampaignByName(other.id, "__verify_portal_other__");
    const a = await createCreatorWithPartnership({ clientId: client.id, name: "Verify Portal", links: ["https://www.instagram.com/__verify_portal__"], campaignId, businessEmail: "secret-creator@example.test", notes: "SECRET_CREATOR_NOTE_7731" });
    const b = await createCreatorWithPartnership({ clientId: other.id, name: "Verify Portal Other", links: ["https://www.instagram.com/__verify_portal_o__"], campaignId: otherCampaign });
    creatorIds.push(a.creatorId, b.creatorId);
    // Two more of this client's: one with a hostile address at Ready to ship, one with an address that isn't there yet.
    const evil = await createCreatorWithPartnership({ clientId: client.id, name: "Verify Portal Evil", links: ["https://www.instagram.com/__verify_portal_evil__"], campaignId });
    const early = await createCreatorWithPartnership({ clientId: client.id, name: "Verify Portal Early", links: ["https://www.instagram.com/__verify_portal_early__"], campaignId });
    creatorIds.push(evil.creatorId, early.creatorId);
    await db
      .update(schema.cmPartnerships)
      .set({ recipientName: '=HYPERLINK("http://x.test","click")', addressLine1: "+1 Evil St", addressLine2: "@SUM(A1)", city: "-Town", region: "CA", postalCode: "90001" })
      .where(eq(schema.cmPartnerships.id, evil.partnershipId));
    await db.update(schema.cmPartnerships).set({ recipientName: "Early Bird", addressLine1: "9 Not Yet Rd", city: "Soonville", region: "CA", postalCode: "90002" }).where(eq(schema.cmPartnerships.id, early.partnershipId));
    await db
      .update(schema.cmPartnerships)
      .set({ emailSummary: "SECRET_SUMMARY_7731", agreedTerms: "SECRET_TERMS_7731", notes: "SECRET_NOTE_7731", feeAmount: "4242.00", addressLine1: "1 Test St", city: "Testville", region: "CA", postalCode: "90000", recipientName: "Verify Portal" })
      .where(eq(schema.cmPartnerships.id, a.partnershipId));
    await db.insert(schema.cmOutreachEvents).values({ partnershipId: a.partnershipId, direction: "inbound", channel: "email", kind: "reply", body: "SECRET_BODY_7731", subject: "SECRET_BODY_7731" });
    const [owner] = await db.insert(schema.cmTeamMembers).values({ name: "SECRET_OWNER_7731", email: "__verify_secret_owner@example.test" }).returning();
    ownerMemberId = owner.id;
    await db.update(schema.cmPartnerships).set({ ownerId: owner.id }).where(eq(schema.cmPartnerships.id, a.partnershipId));
    await db.insert(schema.cmContracts).values({ partnershipId: a.partnershipId, source: "upload", filename: "SECRET_CONTRACT_7731.pdf", data: "SECRET_CONTRACT_7731", readStatus: "read", extracted: { terms: "SECRET_CONTRACT_7731" } });
    await db.update(schema.cmPartnerships).set({ emailDeal: { facts: { terms: "SECRET_EMAIL_DEAL_7731" } }, dealDismissed: ["SECRET_EMAIL_DEAL_7731"], statusNote: "SECRET_STATUS_NOTE_7731", statusNoteBy: "Sam", archivedUntil: new Date(Date.now() + 86_400_000), archivedAt: new Date(), archiveStage: "shortlisted", archiveReason: "SECRET_ARCHIVE_7731", emailStage: "contacted", emailStageQuote: "SECRET_STAGE_QUOTE_7731", emailStageAt: new Date(), promiseText: "SECRET_PROMISE_7731", promiseQuote: "SECRET_PROMISE_QUOTE_7731", promiseAt: new Date() }).where(eq(schema.cmPartnerships.id, a.partnershipId));

    console.log("\n── What the portal returns ──");
    const mine = await getPortalCreators(client.id);
    const row = mine.find((c) => c.partnershipId === a.partnershipId);
    check("the client's creator is there", !!row);
    check("…with exactly the agreed fields", !!row && JSON.stringify(Object.keys(row).sort()) === JSON.stringify([...PORTAL_CREATOR_KEYS].sort()), row && Object.keys(row).join(","));
    const dump = JSON.stringify(mine);
    const leaked = SECRETS.filter((s) => dump.includes(s));
    check("no email text, summary, fee, terms, notes, contract or creator email ever reaches it", leaked.length === 0, leaked.join(", "));
    check("another client's creators never appear", !mine.some((c) => c.partnershipId === b.partnershipId));
    check("who owns the deal on our side never reaches the portal", !!ownerMemberId && !dump.includes(ownerMemberId) && !dump.includes("SECRET_OWNER_7731"));
    check("no address before it's theirs to ship", row?.shipTo === null && row?.shipToParts === null);

    await changeStage(a.partnershipId, "fulfilling");
    const ready = (await getPortalCreators(client.id)).find((c) => c.partnershipId === a.partnershipId)!;
    check("Ready to ship: the address is shown so they can send it", ready.stage === "fulfilling" && /1 Test St/.test(ready.shipTo ?? ""));
    check("…and in parts, for the shipping list", ready.shipToParts?.line1 === "1 Test St" && ready.shipToParts.city === "Testville" && ready.shipToParts.postalCode === "90000");
    check(
      "the address parts are exactly these keys",
      JSON.stringify(Object.keys(ready.shipToParts ?? {}).sort()) === JSON.stringify(["city", "country", "line1", "line2", "postalCode", "recipient", "region"]),
    );

    console.log("\n── Views: labelled, and never added together ──");
    await db.insert(schema.cmDeliverables).values([
      { partnershipId: a.partnershipId, url: "https://www.instagram.com/reel/__verify_v1/", views: 1000, metricsSource: "ig_public_chrome" },
      { partnershipId: a.partnershipId, url: "https://www.instagram.com/reel/__verify_v2/", views: 300, metricsSource: "apify" },
      { partnershipId: a.partnershipId, url: "https://www.instagram.com/reel/__verify_v3/", views: 50, metricsSource: null },
      { partnershipId: a.partnershipId, url: "https://www.instagram.com/reel/__verify_v4/", views: null, metricsSource: null },
    ]);
    const withVideos = (await getPortalCreators(client.id)).find((c) => c.partnershipId === a.partnershipId)!;
    const byUrl = (part: string) => withVideos.videos.find((v) => v.url.includes(part));
    check(
      "each video carries exactly url, postedAt, views and viewsKind",
      withVideos.videos.length === 4 &&
        withVideos.videos.every((v) => JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...PORTAL_VIDEO_KEYS].sort())) &&
        JSON.stringify([...PORTAL_VIDEO_KEYS].sort()) === JSON.stringify(["postedAt", "url", "views", "viewsKind"]),
    );
    check("Instagram's public count is verified", byUrl("__verify_v1")?.viewsKind === "verified");
    check("the automated count is estimated", byUrl("__verify_v2")?.viewsKind === "estimated");
    check("a count with no source is never verified", byUrl("__verify_v3")?.viewsKind === "estimated");
    check("no count, no label", byUrl("__verify_v4")?.views === null && byUrl("__verify_v4")?.viewsKind === null);
    check(
      "the labelling rule, on its own",
      viewsKindOf(5, "ig_public_chrome") === "verified" && viewsKindOf(5, "apify") === "estimated" && viewsKindOf(5, null) === "estimated" && viewsKindOf(null, "ig_public_chrome") === null,
    );
    const totals = portalViewTotals([withVideos]);
    check(
      "totals keep verified and estimated apart, with no combined figure",
      totals.verified === 1000 && totals.verifiedVideos === 1 && totals.estimated === 350 && totals.estimatedVideos === 2 &&
        JSON.stringify(Object.keys(totals).sort()) === JSON.stringify(["estimated", "estimatedVideos", "verified", "verifiedVideos"]),
      JSON.stringify(totals),
    );

    console.log("\n── The shipping list ──");
    await changeStage(evil.partnershipId, "fulfilling");
    const everyone = await getPortalCreators(client.id);
    const csv = shippingListCsv(everyone);
    const lines = csv.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    check("opens as UTF-8 in Excel (byte-order mark) with exactly the agreed header", csv.startsWith("\uFEFF") && lines[0] === SHIPPING_LIST_HEADER.map((h) => `"${h}"`).join(","), lines[0]);
    check("Ready-to-ship creators are on it", lines.some((l) => l.startsWith('"Verify Portal",')) && lines.some((l) => l.startsWith('"Verify Portal Evil",')));
    const readyNames = new Set(everyone.filter((c) => c.stage === "fulfilling" && c.shipToParts).map((c) => csvCell(c.name)));
    check("…and only them: nobody whose address isn't theirs to ship yet", !csv.includes("Verify Portal Early") && !csv.includes("9 Not Yet Rd") && lines.slice(1).every((l) => readyNames.has((l.match(/^"(?:[^"]|"")*"/) ?? [""])[0])));
    const csvLeaks = SECRETS.filter((s) => csv.includes(s));
    check("nothing private is on it", csvLeaks.length === 0, csvLeaks.join(", "));
    check(
      "no cell a spreadsheet would run as a formula",
      csv.includes(`"'=HYPERLINK(""http://x.test"",""click"")"`) && csv.includes(`"'+1 Evil St"`) && csv.includes(`"'@SUM(A1)"`) && csv.includes(`"'-Town"`),
    );
    // Rule tightened (security review, 2026-09-28): tabs and line breaks become spaces — one line per cell, so
    // nothing can start a new cell — and a formula after a ";" (the separator in many European settings) is
    // neutralised too, not only at the start.
    check(
      "the cell rule, on its own",
      csvCell("=1+1") === `"'=1+1"` && csvCell('He said "hi"') === `"He said ""hi"""` && csvCell(null) === `""` && csvCell("Plain") === `"Plain"`,
    );
    check("a line break or tab never starts a new cell", csvCell("a\r\nb") === `"a b"` && csvCell("a\tb") === `"a b"` && csvCell("\t=cmd") === `" '=cmd"`);
    check("a formula hiding after a ; is neutralised", csvCell('12 Main St;=HYPERLINK("http://x.test")') === `"12 Main St;'=HYPERLINK(""http://x.test"")"` && csvCell("Rd; +1") === `"Rd; '+1"`);
    const mineLine = lines.find((l) => l.startsWith('"Verify Portal",')) ?? "";
    check(
      "the Instagram cell is the bare handle (no stray apostrophe from the guard)",
      mineLine.split('","')[1] === "__verify_portal__" && lines.slice(1).every((l) => !(l.split('","')[1] ?? "").startsWith("'")),
      mineLine,
    );

    console.log("\n── What the portal can do ──");
    const matrix = (["shortlisted", "awaiting_address", "fulfilling", "shipped", "content_pending", "posted", "passed"] as const).map((s) => [s, clientMayShip(s, "shipped"), clientMayShip(s, "delivered")] as const);
    check(
      "the client marks shipped only from Ready to ship, and delivered only once it's on its way",
      matrix.every(([s, sh, de]) => sh === (s === "fulfilling") && de === (s === "shipped")),
      JSON.stringify(matrix),
    );
    check("a client can't reach another client's creator", (await partnershipOfClient(client.id, b.partnershipId)) === null && (await partnershipOfClient(other.id, a.partnershipId)) === null);
    const p = await partnershipOfClient(client.id, a.partnershipId);
    const shipped = await recordShipment({ id: p?.shipmentId ?? undefined, partnershipId: a.partnershipId, status: "shipped", carrier: "UPS", trackingNumber: "1ZVERIFY" }, { kind: "client", id: "00000000-0000-0000-0000-000000000009", name: "Rob Client" });
    const [st] = await db.select({ stage: schema.cmPartnerships.stage }).from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, a.partnershipId));
    check("the client marking it shipped moves them to Shipped", shipped.ok && st.stage === "shipped");
    const [t] = await db.select().from(schema.cmStageTransitions).where(and(eq(schema.cmStageTransitions.partnershipId, a.partnershipId), eq(schema.cmStageTransitions.toStage, "shipped")));
    check("…through the same rule, recorded as done by them", t?.source === "rule" && (t.meta as { byClient?: string } | null)?.byClient === "Rob Client" && t.changedBy === null);
    const notes = await db.select().from(schema.cmOutreachEvents).where(and(eq(schema.cmOutreachEvents.partnershipId, a.partnershipId), eq(schema.cmOutreachEvents.kind, "note")));
    check("…and noted on the timeline with the tracking number", notes.some((n) => /Marked shipped by Rob Client · UPS 1ZVERIFY/.test(n.body ?? "")));
    const after = (await getPortalCreators(client.id)).find((c) => c.partnershipId === a.partnershipId)!;
    check("once shipped, the address is no longer shown", after.shipTo === null && after.shipToParts === null && after.shipment?.trackingNumber === "1ZVERIFY");
    check("…and they're off the shipping list", !shippingListCsv(await getPortalCreators(client.id)).includes('"Verify Portal",'));
  } finally {
    if (creatorIds.length) await db.delete(schema.cmCreators).where(inArray(schema.cmCreators.id, creatorIds));
    await db.delete(schema.cmCampaigns).where(inArray(schema.cmCampaigns.id, [campaignId, otherCampaign]));
    await db.delete(schema.clients).where(eq(schema.clients.id, other.id));
    if (ownerMemberId) await db.delete(schema.cmTeamMembers).where(eq(schema.cmTeamMembers.id, ownerMemberId));
  }
  check("test rows cleaned up", (await db.select().from(schema.cmCampaigns).where(eq(schema.cmCampaigns.id, campaignId))).length === 0);
}

main().then(
  () => {
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
