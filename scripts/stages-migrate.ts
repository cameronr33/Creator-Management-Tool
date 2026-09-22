/**
 * One-time move of partnerships off the four retired stages (owner decision,
 * 2026-09-22: seven stages). Each move goes through the stage-move core, so it
 * gets the same shipment guard and a cm_stage_transitions row
 * (source "migration") like any other move.
 *
 *   npm run stages:migrate -- --dry-run   # list what would move
 *   npm run stages:migrate -- --apply     # move them
 *
 * researched → To contact, negotiating → Talking, agreed → Agreed (or Shipping
 * when the address is already complete), completed → Posted (only when a
 * video is recorded; otherwise it is reported and left for a person).
 */
import { inArray, eq, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { moveStage } from "../src/lib/stage-moves";
import { RETIRED_STAGES, stageLabel } from "../src/lib/stages";
import type { CmStage } from "../src/lib/db/schema";

async function main() {
  const apply = process.argv.includes("--apply");
  if (!apply && !process.argv.includes("--dry-run")) throw new Error("Pass --dry-run or --apply");

  const retired = Object.keys(RETIRED_STAGES) as CmStage[];
  const rows = await db
    .select({ id: schema.cmPartnerships.id, stage: schema.cmPartnerships.stage, name: schema.cmCreators.name })
    .from(schema.cmPartnerships)
    .innerJoin(schema.cmCreators, eq(schema.cmCreators.id, schema.cmPartnerships.creatorId))
    .where(inArray(schema.cmPartnerships.stage, retired));

  console.log(`${rows.length} partnership(s) on a retired stage${apply ? "" : " (dry run — nothing written)"}`);
  let moved = 0;
  let left = 0;
  for (const r of rows) {
    const to = RETIRED_STAGES[r.stage]!;
    if (!apply) {
      console.log(`  ${r.name}: ${r.stage} → ${stageLabel(to)}`);
      continue;
    }
    const res = await moveStage({
      partnershipId: r.id,
      to,
      source: "migration",
      expectFrom: r.stage,
      reason: `stages simplified: ${r.stage} → ${to}`,
      meta: { retiredStage: r.stage },
    });
    if (res.status === "moved") {
      moved++;
      console.log(`  ${r.name}: ${r.stage} → ${stageLabel(res.to)}${res.createdShipmentId ? " (shipment created)" : ""}`);
    } else {
      left++;
      console.log(`  ${r.name}: left on ${r.stage} — ${res.status}${res.status === "needs_video" ? " (no video recorded; a person must add it or pick another stage)" : ""}`);
    }
  }
  if (apply) {
    const remaining = await db.execute(sql`select count(*)::int as n from cm_partnerships where stage in ('researched','negotiating','agreed','completed')`);
    console.log(`moved ${moved}, left ${left}; ${(remaining.rows[0] as { n: number }).n} still on a retired stage`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
