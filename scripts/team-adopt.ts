/**
 * One-off after migration 0024 (2026-09-29): hand each deal that was
 * assigned to a login before the team list existed to that login's team
 * member — the same thing that happens the next time the login opens the
 * app (owners.ts memberForUser). Reads the shared users table; never writes it.
 *
 *   npm run team:adopt -- --dry-run   # list what would be handed over
 *   npm run team:adopt -- --apply
 */
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { memberForUser } from "../src/lib/owners";

async function main() {
  const apply = process.argv.includes("--apply");
  if (!apply && !process.argv.includes("--dry-run")) throw new Error("Pass --dry-run or --apply");
  const rows = await db
    .select({ userId: schema.cmPartnerships.legacyOwnerUserId, n: sql<number>`count(*)::int` })
    .from(schema.cmPartnerships)
    .where(and(isNotNull(schema.cmPartnerships.legacyOwnerUserId), isNull(schema.cmPartnerships.ownerId)))
    .groupBy(schema.cmPartnerships.legacyOwnerUserId);
  console.log(`${rows.length} login(s) with deals still on the old owner${apply ? "" : " (dry run — nothing written)"}`);
  for (const r of rows) {
    const [login] = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, r.userId!)).limit(1);
    if (!login) {
      console.log(`  ${r.n} deal(s) on a login that no longer exists — left as they are`);
      continue;
    }
    if (!apply) {
      console.log(`  ${login.name}: ${r.n} deal(s) would go to their team member`);
      continue;
    }
    const me = await memberForUser({ ...login, kind: "agency" });
    console.log(`  ${login.name}: ${me ? `${r.n} deal(s) now owned by team member ${me.name}` : "couldn't get a team member — check Settings → Team for a clashing email"}`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
