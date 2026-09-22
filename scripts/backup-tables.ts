/**
 * Write every row of the named tables to backups/<timestamp>/<table>.json
 * (gitignored) before a destructive change, so nothing removed on purpose is
 * removed irrecoverably.
 *
 *   npm run db:backup -- cm_email_suggestions            # back up only
 *   npm run db:backup -- cm_email_suggestions --clear    # back up, then delete the rows
 *
 * Only cm_* tables are accepted (frozen node 4: shared tables are never
 * touched). --clear deletes rows only after the backup file is written and
 * re-read with the same row count.
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { sql } from "drizzle-orm";
import { db } from "./db";

async function main() {
  const args = process.argv.slice(2);
  const clear = args.includes("--clear");
  const tables = args.filter((a) => !a.startsWith("--"));
  if (tables.length === 0) throw new Error("Name at least one cm_* table");
  for (const t of tables) {
    if (!/^cm_[a-z_]+$/.test(t)) throw new Error(`Refusing ${t}: only cm_* tables can be backed up or cleared`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = resolve(__dirname, "../backups", stamp);
  mkdirSync(dir, { recursive: true });

  for (const table of tables) {
    const exists = await db.execute(sql`select to_regclass(${table}) as reg`);
    if (!(exists.rows[0] as { reg: string | null }).reg) {
      console.log(`${table}: not present, skipped`);
      continue;
    }
    const rows = (await db.execute(sql.raw(`select * from "${table}"`))).rows;
    const file = resolve(dir, `${table}.json`);
    writeFileSync(file, JSON.stringify(rows, null, 2));
    const reread = JSON.parse(readFileSync(file, "utf8")) as unknown[];
    if (reread.length !== rows.length) throw new Error(`${table}: backup verification failed`);
    console.log(`${table}: ${rows.length} rows → ${file}`);
    if (clear && rows.length > 0) {
      await db.execute(sql.raw(`delete from "${table}"`));
      console.log(`${table}: rows deleted`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
