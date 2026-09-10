/**
 * Repairs partnerships that ended up with more than one cm_shipments row —
 * a double-submit race that the API no longer allows (see
 * src/app/api/shipments/route.ts), but which left rows behind before the fix.
 *
 *   npm run fix:duplicate-shipments            # DRY RUN — prints the plan
 *   npm run fix:duplicate-shipments -- --apply # actually merges
 *
 * Merge rule: keep the OLDEST row (the one other tables would have referenced
 * first), promote it to the most advanced status among the duplicates, and
 * carry over the first non-null carrier / tracking number / dates / notes so
 * no operator-entered value is lost. Then delete the redundant rows.
 *
 * Nothing is deleted without --apply, and the plan is printed either way.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";

const STATUS_RANK: Record<string, number> = { ready: 0, shipped: 1, delivered: 2, returned: 3 };

async function main() {
  const apply = process.argv.includes("--apply");

  const dupRes = (await db.execute(sql`
    select partnership_id from cm_shipments group by partnership_id having count(*) > 1
  `)) as unknown as { rows?: { partnership_id: string }[] };
  const partnershipIds = (dupRes.rows ?? []).map((r) => r.partnership_id);

  if (partnershipIds.length === 0) {
    console.log("No partnership has duplicate shipments. Nothing to do.");
    return;
  }

  console.log(`${partnershipIds.length} partnership(s) with duplicate shipments:\n`);

  for (const pid of partnershipIds) {
    const rows = await db
      .select()
      .from(schema.cmShipments)
      .where(eq(schema.cmShipments.partnershipId, pid))
      .orderBy(schema.cmShipments.createdAt);
    const [creator] = await db
      .select({ name: schema.cmCreators.name, stage: schema.cmPartnerships.stage })
      .from(schema.cmPartnerships)
      .innerJoin(schema.cmCreators, eq(schema.cmPartnerships.creatorId, schema.cmCreators.id))
      .where(eq(schema.cmPartnerships.id, pid))
      .limit(1);

    const keep = rows[0];
    const drop = rows.slice(1);
    const best = rows.reduce((a, b) => ((STATUS_RANK[b.status] ?? 0) > (STATUS_RANK[a.status] ?? 0) ? b : a));
    const firstOf = <K extends keyof typeof keep>(k: K) => rows.map((r) => r[k]).find((v) => v != null) ?? null;

    const merged = {
      status: best.status,
      carrier: firstOf("carrier"),
      trackingNumber: firstOf("trackingNumber"),
      shippedAt: firstOf("shippedAt"),
      deliveredAt: firstOf("deliveredAt"),
      notes: firstOf("notes"),
    };

    console.log(`  ${creator?.name ?? pid} (stage ${creator?.stage ?? "?"})`);
    for (const r of rows) {
      console.log(
        `    ${r.id === keep.id ? "KEEP  " : "DELETE"} ${r.id}  status=${r.status}  carrier=${r.carrier ?? "-"}  tracking=${r.trackingNumber ?? "-"}  created=${r.createdAt.toISOString()}`,
      );
    }
    console.log(`    → merged: status=${merged.status} carrier=${merged.carrier ?? "-"} tracking=${merged.trackingNumber ?? "-"}`);

    if (apply) {
      await db
        .update(schema.cmShipments)
        .set({ ...merged, updatedAt: new Date() })
        .where(eq(schema.cmShipments.id, keep.id));
      await db.delete(schema.cmShipments).where(
        inArray(schema.cmShipments.id, drop.map((r) => r.id)),
      );
      console.log(`    ✓ merged, ${drop.length} row(s) deleted`);
    }
    console.log("");
  }

  if (!apply) {
    console.log("DRY RUN — nothing was changed. Re-run with -- --apply to perform the merge.");
  } else {
    console.log("Done. Re-run `npm run verify:invariants` to confirm.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
