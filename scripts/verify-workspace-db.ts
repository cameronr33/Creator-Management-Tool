import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { getWorkspaceItems } from "../src/lib/workspace-data";

if (process.env.CREATOR_LOCAL_PREVIEW !== "1" || process.env.DATABASE_URL !== "postgresql://preview:preview@localhost:5544/creator_preview") {
  throw new Error("Workspace DB checks require the isolated preview runner.");
}

async function main() {
  const clientId = randomUUID();
  try {
    await db.insert(schema.clients).values({ id: clientId, name: "__verify_workspace", slug: `__verify_workspace_${clientId}` });
    const [creator] = await db.insert(schema.cmCreators).values({ clientId, name: "__verify_workspace", username: "__verify_workspace", profileUrl: "https://example.test/creator" }).returning();
    const [campaignA, campaignB] = await db.insert(schema.cmCampaigns).values([
      { clientId, name: "__verify_campaign_A" }, { clientId, name: "__verify_campaign_B" },
    ]).returning();
    const [partnershipA, partnershipB] = await db.insert(schema.cmPartnerships).values([
      { creatorId: creator.id, campaignId: campaignA.id, stage: "awaiting_address" as const },
      { creatorId: creator.id, campaignId: campaignB.id, stage: "contacted" as const },
    ]).returning();
    await db.insert(schema.cmShipments).values([
      { partnershipId: partnershipA.id, status: "ready" }, { partnershipId: partnershipA.id, status: "delivered" },
    ]);
    await db.insert(schema.cmOutreachEvents).values({ partnershipId: partnershipB.id, direction: "outbound", channel: "email", kind: "initial", isMigrated: true, occurredAt: new Date("2025-01-01") });
    const rows = await getWorkspaceItems(clientId);
    assert.equal(rows.length, 2, "multiple packages cannot multiply worklist rows");
    assert.equal(new Set(rows.map(r => r.creatorId)).size, 1, "a creator can retain distinct campaign records");
    assert.equal(new Set(rows.map(r => r.campaignId)).size, 2);
    const a = rows.find(r => r.partnershipId === partnershipA.id)!;
    const b = rows.find(r => r.partnershipId === partnershipB.id)!;
    assert.equal(a.lane, "review");
    assert.match(a.shipping, /2 records/);
    assert.equal(b.lastContact, "Imported · date unknown");
    assert.equal(b.dueLabel, null);
    assert.deepEqual(await getWorkspaceItems(randomUUID()), [], "other client data stays out of this query");
    console.log("PASS: real workspace query keeps one row per partnership, campaign scope, all shipment records and honest dates.");
  } finally {
    await db.delete(schema.clients).where(eq(schema.clients.id, clientId));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
