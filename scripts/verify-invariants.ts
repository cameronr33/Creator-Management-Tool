/**
 * FROZEN INVARIANTS — read-only checks against the live database.
 *
 *   npm run verify:invariants
 *
 * These are the rules the optimizing loops (auto-stage, ingest, sync, the
 * agents building this app) are never allowed to "tune" to make a check pass.
 * They are the held-out set: if one fails, the DATA is wrong, not the check.
 * Change a rule here only with a human decision, and say why in the commit.
 *
 * Reads only — safe to run against production, and meant to be.
 */
import { and, eq, isNotNull, sql, inArray } from "drizzle-orm";
import { db, schema } from "./db";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}
async function count(q: Promise<{ n: number }[]>): Promise<number> {
  return (await q)[0]?.n ?? 0;
}
const N = sql<number>`count(*)::int`;

/** Scalar from raw SQL — used where the check is an aggregate of an aggregate. */
async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const res = (await db.execute(query)) as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
  const rows = Array.isArray(res) ? res : (res.rows ?? []);
  const first = rows[0] ?? {};
  return Number(Object.values(first)[0] ?? 0);
}

async function main() {
  console.log("\n── Stage integrity: the stage never contradicts the tables it summarizes ──");
  // Every partnership at fulfilling or later has a shipment row.
  const lateNoShipment = await count(
    db
      .select({ n: N })
      .from(schema.cmPartnerships)
      .leftJoin(schema.cmShipments, eq(schema.cmShipments.partnershipId, schema.cmPartnerships.id))
      .where(
        and(
          inArray(schema.cmPartnerships.stage, ["fulfilling", "shipped", "content_pending", "posted", "completed"]),
          sql`${schema.cmShipments.id} is null`,
        ),
      ),
  );
  check("no partnership ≥ fulfilling without a shipment", lateNoShipment === 0, `${lateNoShipment} violations`);

  const postedNoVideo = await count(
    db
      .select({ n: N })
      .from(schema.cmPartnerships)
      .leftJoin(schema.cmDeliverables, eq(schema.cmDeliverables.partnershipId, schema.cmPartnerships.id))
      .where(and(inArray(schema.cmPartnerships.stage, ["posted", "completed"]), sql`${schema.cmDeliverables.id} is null`)),
  );
  check("no partnership at posted/completed without a deliverable", postedNoVideo === 0, `${postedNoVideo} violations`);

  // Owner decision 2026-09-22: seven stages. The four retired enum values
  // stay in Postgres but nothing may hold them (stages:migrate moved them).
  const retired = await count(
    db
      .select({ n: N })
      .from(schema.cmPartnerships)
      .where(inArray(schema.cmPartnerships.stage, ["researched", "negotiating", "agreed", "completed"])),
  );
  check("no partnership uses a retired stage", retired === 0, `${retired} rows — run npm run stages:migrate`);

  // Deleting from a campaign removes a creator left in none (campaigns.ts removePartnerships);
  // a creator in no campaign would be invisible everywhere yet still have their email searched.
  const orphans = await count(
    db
      .select({ n: N })
      .from(schema.cmCreators)
      .where(sql`not exists (select 1 from ${schema.cmPartnerships} p where p.creator_id = ${schema.cmCreators.id})`),
  );
  check("every creator is in at least one campaign", orphans === 0, `${orphans} creator(s) in no campaign`);

  console.log("\n── Metric provenance: estimates are never dressed as authoritative ──");
  const viewsNoSource = await count(
    db
      .select({ n: N })
      .from(schema.cmCreators)
      .where(and(isNotNull(schema.cmCreators.avgViews), sql`${schema.cmCreators.viewsSource} is null`)),
  );
  check("every creator with view numbers has a viewsSource label", viewsNoSource === 0, `${viewsNoSource} unlabeled`);
  const delivViewsNoSource = await count(
    db
      .select({ n: N })
      .from(schema.cmDeliverables)
      .where(and(isNotNull(schema.cmDeliverables.views), sql`${schema.cmDeliverables.metricsSource} is null`)),
  );
  check("every deliverable with views has a metricsSource label", delivViewsNoSource === 0, `${delivViewsNoSource} unlabeled`);

  console.log("\n── Pipeline hygiene ──");
  const terminalNoReason = await count(
    db
      .select({ n: N })
      .from(schema.cmPartnerships)
      .where(and(inArray(schema.cmPartnerships.stage, ["passed", "declined"]), sql`${schema.cmPartnerships.exitReason} is null`)),
  );
  // Informational: the HELLA import deliberately left Trail Boss Dad unresolved.
  console.log(`  [info] passed/declined without an exit reason: ${terminalNoReason} (should trend to 0)`);
  const multiShip = await scalar(sql`
    select count(*)::int from (
      select partnership_id from cm_shipments
      group by partnership_id having count(*) > 1
    ) dup`);
  check("one shipment per partnership", multiShip === 0, `${multiShip} partnerships with several`);

  console.log("\n── Sync integrity ──");
  const activeAccounts = await count(
    db.select({ n: N }).from(schema.cmGmailAccounts).where(eq(schema.cmGmailAccounts.isActive, true)),
  );
  check("at most one active Gmail account", activeAccounts <= 1, `${activeAccounts}`);
  const dupExternal = await scalar(sql`
    select count(*)::int from (
      select external_id from cm_outreach_events
      where external_id is not null
      group by external_id having count(*) > 1
    ) dup`);
  check("no duplicated synced message (externalId unique in practice)", dupExternal === 0);

  console.log("\n── Test hygiene: verification scripts left nothing behind ──");
  const leftovers = await count(
    db.select({ n: N }).from(schema.cmCreators).where(sql`${schema.cmCreators.username} like '\\_\\_verify%' escape '\\'`),
  );
  const leftoverCampaigns = await count(
    db.select({ n: N }).from(schema.cmCampaigns).where(sql`${schema.cmCampaigns.name} like '\\_\\_verify%' escape '\\'`),
  );
  const leftoverAccounts = await count(
    db.select({ n: N }).from(schema.cmGmailAccounts).where(sql`${schema.cmGmailAccounts.email} like '\\_\\_verify%' escape '\\'`),
  );
  check("no __verify_ creators/campaigns/accounts in the database", leftovers + leftoverCampaigns + leftoverAccounts === 0, `${leftovers}/${leftoverCampaigns}/${leftoverAccounts}`);

  console.log("\n── Shared tables untouched by this app's verification ──");
  const clientsN = await count(db.select({ n: N }).from(schema.clients));
  check("shared client roster is non-empty and readable", clientsN > 0);
}

main()
  .then(() => {
    console.log(`\n${failures === 0 ? "ALL INVARIANTS HOLD" : `${failures} INVARIANT(S) VIOLATED`}`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
