/**
 * Shared DB client for standalone scripts run via tsx (outside Next.js, so the
 * "@/" path alias and the lazy proxy in src/lib/db aren't available here).
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../src/lib/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set (use --env-file=.env.local)");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
export const db = drizzle(sql, { schema });
export { schema };
