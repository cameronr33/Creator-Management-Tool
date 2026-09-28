/**
 * Verifies that db:apply runs each migration once, so a DROP stays dropped.
 *
 *   npm run preview:verify -- scripts/verify-schema-journal.ts
 *
 * Runs scripts/apply-schema.ts twice against the isolated preview database:
 * the second run must apply nothing, and the tables retired on 2026-09-23 must
 * not exist afterwards (before the journal, every deploy replayed their
 * original CREATE TABLE and brought them back).
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "./db";

if (process.env.CREATOR_LOCAL_PREVIEW !== "1") throw new Error("Run through npm run preview:verify — this applies migrations.");

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const RETIRED = ["cm_alerts", "cm_api_keys", "cm_creator_reels", "cm_email_suggestions", "cm_message_templates", "cm_research_requests", "cm_research_runs"];

function applyOnce(): string {
  const r = spawnSync(process.execPath, ["--require", "tsx/cjs", resolve(__dirname, "apply-schema.ts")], { env: process.env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`db:apply failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

async function main() {
  const files = readdirSync(resolve(__dirname, "../src/lib/db/migrations")).filter((f) => f.endsWith(".sql"));
  const first = applyOnce();
  check("the first run records every migration", /Schema applied: \d+ migration file\(s\) run/.test(first), first.trim());
  const second = applyOnce();
  check("the second run applies nothing", second.includes("0 migration file(s) run") && second.includes(" 0 new"), second.trim());
  const journal = (await db.execute(sql`select count(*)::int as n from cm_schema_migrations`)).rows[0] as { n: number };
  check("the journal holds one row per migration file", Number(journal.n) === files.length, `${journal.n} vs ${files.length}`);
  const present: string[] = [];
  for (const t of RETIRED) {
    const reg = (await db.execute(sql`select to_regclass(${t}) as reg`)).rows[0] as { reg: string | null };
    if (reg.reg) present.push(t);
  }
  check("every retired table stays dropped after repeated runs", present.length === 0, present.join(", "));

  // Frozen node 4: shared tables are never altered by this app's migrations (FKs pointing at them are fine).
  const SHARED_CHANGE = /\b(?:ALTER|DROP)\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"public"\.)?"(?:users|sa_clients)"/i;
  const dir = resolve(__dirname, "../src/lib/db/migrations");
  const touching = files.filter((f) => SHARED_CHANGE.test(readFileSync(resolve(dir, f), "utf8")));
  check("no migration alters or drops the shared users / sa_clients tables", touching.length === 0, touching.join(", "));
  check("…and that check catches one that would", SHARED_CHANGE.test('ALTER TABLE "users" ADD COLUMN "x" text') && !SHARED_CHANGE.test('ALTER TABLE "cm_partnerships" ADD CONSTRAINT "f" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id")'));
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
