/**
 * Shared DB client for standalone scripts run via tsx (outside Next.js, so the
 * "@/" path alias and the lazy proxy in src/lib/db aren't available here).
 *
 * Mirrors src/lib/db/index.ts's driver choice: Neon over HTTP in production, a
 * node-postgres TCP connection for a local or CI Postgres.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import * as schema from "../src/lib/db/schema";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL must be set (use --env-file=.env.local)");
  process.exit(1);
}

function isNeonUrl(u: string): boolean {
  try {
    return new URL(u).hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

export const db = isNeonUrl(url)
  ? drizzle(neon(url), { schema })
  : (drizzleNodePg(url, { schema }) as unknown as ReturnType<typeof drizzle<typeof schema>>);
export { schema };
