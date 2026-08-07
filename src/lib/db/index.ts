import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type Schema = typeof schema;

let _db: NeonHttpDatabase<Schema> | null = null;

function getDb(): NeonHttpDatabase<Schema> {
  if (!_db) {
    const sql = neon(process.env.DATABASE_URL!);
    _db = drizzle(sql, { schema });
  }
  return _db;
}

// Lazy proxy so importing this module never touches DATABASE_URL at build time.
export const db = new Proxy({} as NeonHttpDatabase<Schema>, {
  get(_target, prop) {
    return getDb()[prop as keyof NeonHttpDatabase<Schema>];
  },
});
