import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { runFollowUpSweep } from "../src/lib/alerts";

// This regression writes a dedicated fixture client. Refuse any real database.
if (process.env.CREATOR_LOCAL_PREVIEW !== "1" || process.env.DATABASE_URL !== "postgresql://preview:preview@localhost:5544/creator_preview") {
  throw new Error("Run npm run preview:verify -- scripts/verify-follow-up-coverage.ts against the isolated preview database.");
}

async function main() {
  const prefix = `__verify_coverage_${Date.now()}`;
  const [client] = await db.insert(schema.clients).values({ name: prefix, slug: prefix }).returning();
  try {
    const [campaign] = await db.insert(schema.cmCampaigns).values({ clientId: client.id, name: prefix }).returning();
    async function fixture(suffix: string, followUps: number, daysAgo: number, channel: "email" | "ig_dm", reply = false, migrated = false) {
      const [creator] = await db.insert(schema.cmCreators).values({ clientId: client.id, name: `${prefix}_${suffix}`, username: `${prefix}_${suffix}`, profileUrl: `https://example.test/${suffix}` }).returning();
      const [partnership] = await db.insert(schema.cmPartnerships).values({ creatorId: creator.id, campaignId: campaign.id, stage: "contacted" }).returning();
      for (let i = 0; i <= followUps; i++) {
        await db.insert(schema.cmOutreachEvents).values({ partnershipId: partnership.id, direction: "outbound", channel, kind: i === 0 ? "initial" : "follow_up", occurredAt: new Date(Date.now() - (daysAgo + followUps - i) * 86_400_000), isMigrated: migrated });
      }
      if (reply) await db.insert(schema.cmOutreachEvents).values({ partnershipId: partnership.id, direction: "inbound", channel, kind: "reply", occurredAt: new Date() });
      return partnership.id;
    }
    const silentEmail = await fixture("email", 2, 15, "email");
    const silentDm = await fixture("dm", 2, 15, "ig_dm");
    const firstDue = await fixture("first_due", 0, 6, "email");
    const secondDue = await fixture("second_due", 1, 8, "email");
    await fixture("replied", 2, 15, "email", true);
    await fixture("migrated", 2, 15, "email", false, true);

    const result = await runFollowUpSweep(client.id);
    for (const id of [silentEmail, silentDm]) {
      const [row] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, id));
      assert.equal(row.stage, "contacted", "Unobserved silence must not automatically close a partnership");
      const transitions = await db.select().from(schema.cmStageTransitions).where(eq(schema.cmStageTransitions.partnershipId, id));
      assert.equal(transitions.length, 0, "The sweep must not write a closure transition");
    }
    assert.equal(result.movedToNoResponse, 0);
    assert.equal((result as { closuresNeedingReview?: number }).closuresNeedingReview, 2);
    assert.equal(result.alertsOpened, 2, "First and second follow-up tasks still open");
    for (const [id, type] of [[firstDue, "follow_up_1_due"], [secondDue, "follow_up_2_due"]]) {
      const alerts = await db.select().from(schema.cmAlerts).where(eq(schema.cmAlerts.partnershipId, id));
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].type, type);
    }
    const repeated = await runFollowUpSweep(client.id);
    assert.equal(repeated.alertsOpened, 0, "Repeated sweeps remain idempotent");
    assert.equal(repeated.movedToNoResponse, 0);
  } finally {
    await db.delete(schema.clients).where(eq(schema.clients.id, client.id));
  }
  console.log("PASS: incomplete email/off-channel coverage requires closure review; follow-up tasks still open idempotently; fixtures removed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
