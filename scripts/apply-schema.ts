/**
 * Provision the cm_* schema by executing the generated migration SQL directly.
 *
 * We do this instead of `drizzle-kit push` because push's interactive
 * enum-rename resolver can't run in a non-TTY shell (it prompts on every new
 * enum against a DB that already has enums). This script is deterministic and
 * idempotent, and it explicitly SKIPS the CREATE TABLE statements for the
 * shared `users` and `sa_clients` tables — those already exist and are owned by
 * other apps. FK constraints that reference them are still applied.
 *
 *   npm run db:apply
 */
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { sql } from "drizzle-orm";
import { db } from "./db";

const MIGRATIONS_DIR = resolve(__dirname, "../src/lib/db/migrations");

const SKIP_STATEMENTS = [/^CREATE TABLE "users"/i, /^CREATE TABLE "sa_clients"/i];

/**
 * Postgres "this object is already there" codes. Drizzle wraps the driver error,
 * so the real cause (with .code) sits further down the cause chain — walk it
 * rather than only checking the top-level message.
 */
const DUPLICATE_CODES = new Set([
  "42P07", // duplicate_table
  "42710", // duplicate_object (type, constraint)
  "42701", // duplicate_column
  "42P06", // duplicate_schema
  "42P16", // invalid_table_definition (re-adding an existing PK)
]);

function isAlreadyExists(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    const e = cur as { message?: string; code?: string; cause?: unknown };
    if (e.code && DUPLICATE_CODES.has(e.code)) return true;
    if (e.message && /already exists|duplicate/i.test(e.message)) return true;
    cur = e.cause;
  }
  return false;
}

async function main() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    console.error("No migration SQL found. Run `npx drizzle-kit generate` first.");
    process.exit(1);
  }

  let applied = 0;
  let skipped = 0;
  let existed = 0;

  for (const file of files) {
    const raw = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    const statements = raw
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      if (SKIP_STATEMENTS.some((re) => re.test(stmt))) {
        skipped++;
        continue;
      }
      try {
        await db.execute(sql.raw(stmt));
        applied++;
      } catch (err) {
        if (isAlreadyExists(err)) {
          existed++;
          continue;
        }
        console.error(`\nFailed on statement:\n${stmt.slice(0, 200)}\n`);
        throw err;
      }
    }
  }

  console.log(`Schema applied: ${applied} new, ${existed} already existed, ${skipped} shared-table creates skipped.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
