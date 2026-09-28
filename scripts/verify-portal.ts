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
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { getPortalCreators, partnershipOfClient, PORTAL_CREATOR_KEYS } from "../src/lib/portal-data";
import { clientMayShip, recordShipment } from "../src/lib/shipments";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";
import { changeStage } from "../src/lib/mutations";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const SECRETS = ["SECRET_SUMMARY_7731", "SECRET_TERMS_7731", "SECRET_NOTE_7731", "SECRET_BODY_7731", "SECRET_CREATOR_NOTE_7731", "4242.00", "secret-creator@example.test", "SECRET_CONTRACT_7731", "SECRET_EMAIL_DEAL_7731", "SECRET_STATUS_NOTE_7731"];

async function main() {
  const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.slug, "hella")).limit(1);
  const NONE = "00000000-0000-0000-0000-000000000000";
  let other = { id: NONE };
  let campaignId = NONE;
  let otherCampaign = NONE;
  const creatorIds: string[] = [];
  try {
    [other] = await db.insert(schema.clients).values({ name: "__verify_po_other", slug: `__verify_po_${Date.now()}` }).returning();
    campaignId = await ensureCampaignByName(client.id, "__verify_portal__");
    otherCampaign = await ensureCampaignByName(other.id, "__verify_portal_other__");
    const a = await createCreatorWithPartnership({ clientId: client.id, name: "Verify Portal", links: ["https://www.instagram.com/__verify_portal__"], campaignId, businessEmail: "secret-creator@example.test", notes: "SECRET_CREATOR_NOTE_7731" });
    const b = await createCreatorWithPartnership({ clientId: other.id, name: "Verify Portal Other", links: ["https://www.instagram.com/__verify_portal_o__"], campaignId: otherCampaign });
    creatorIds.push(a.creatorId, b.creatorId);
    await db
      .update(schema.cmPartnerships)
      .set({ emailSummary: "SECRET_SUMMARY_7731", agreedTerms: "SECRET_TERMS_7731", notes: "SECRET_NOTE_7731", feeAmount: "4242.00", addressLine1: "1 Test St", city: "Testville", region: "CA", postalCode: "90000", recipientName: "Verify Portal" })
      .where(eq(schema.cmPartnerships.id, a.partnershipId));
    await db.insert(schema.cmOutreachEvents).values({ partnershipId: a.partnershipId, direction: "inbound", channel: "email", kind: "reply", body: "SECRET_BODY_7731", subject: "SECRET_BODY_7731" });
    const [someone] = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).limit(1);
    if (someone) await db.update(schema.cmPartnerships).set({ ownerId: someone.id }).where(eq(schema.cmPartnerships.id, a.partnershipId));
    await db.insert(schema.cmContracts).values({ partnershipId: a.partnershipId, source: "upload", filename: "SECRET_CONTRACT_7731.pdf", data: "SECRET_CONTRACT_7731", readStatus: "read", extracted: { terms: "SECRET_CONTRACT_7731" } });
    await db.update(schema.cmPartnerships).set({ emailDeal: { facts: { terms: "SECRET_EMAIL_DEAL_7731" } }, dealDismissed: ["SECRET_EMAIL_DEAL_7731"], statusNote: "SECRET_STATUS_NOTE_7731", statusNoteBy: "Sam" }).where(eq(schema.cmPartnerships.id, a.partnershipId));

    console.log("\n── What the portal returns ──");
    const mine = await getPortalCreators(client.id);
    const row = mine.find((c) => c.partnershipId === a.partnershipId);
    check("the client's creator is there", !!row);
    check("…with exactly the agreed fields", !!row && JSON.stringify(Object.keys(row).sort()) === JSON.stringify([...PORTAL_CREATOR_KEYS].sort()), row && Object.keys(row).join(","));
    const dump = JSON.stringify(mine);
    const leaked = SECRETS.filter((s) => dump.includes(s));
    check("no email text, summary, fee, terms, notes, contract or creator email ever reaches it", leaked.length === 0, leaked.join(", "));
    check("another client's creators never appear", !mine.some((c) => c.partnershipId === b.partnershipId));
    const [owner] = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).limit(1);
    check("who owns the deal on our side never reaches the portal", !!owner && !dump.includes(owner.id) && !JSON.stringify(mine).includes(`"${owner.name}"`));
    check("no address before it's theirs to ship", row?.shipTo === null);

    await changeStage(a.partnershipId, "fulfilling");
    const ready = (await getPortalCreators(client.id)).find((c) => c.partnershipId === a.partnershipId)!;
    check("Ready to ship: the address is shown so they can send it", ready.stage === "fulfilling" && /1 Test St/.test(ready.shipTo ?? ""));

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
    check("once shipped, the address is no longer shown", after.shipTo === null && after.shipment?.trackingNumber === "1ZVERIFY");
  } finally {
    if (creatorIds.length) await db.delete(schema.cmCreators).where(inArray(schema.cmCreators.id, creatorIds));
    await db.delete(schema.cmCampaigns).where(inArray(schema.cmCampaigns.id, [campaignId, otherCampaign]));
    await db.delete(schema.clients).where(eq(schema.clients.id, other.id));
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
