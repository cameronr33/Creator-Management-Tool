import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type Schema = typeof schema;

/**
 * Neon's serverless driver speaks HTTP to a Neon endpoint, so it can't reach a
 * plain Postgres over TCP. Production always points at Neon; a local or CI
 * Postgres (`postgres://…@localhost/…`) falls back to node-postgres, which
 * exposes the same drizzle query surface. The declared type stays the Neon one
 * because every call site is written against it and the builder API is
 * identical — only transactions (unused here) and `execute()`'s result shape
 * differ.
 */
function isNeonUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

let _db: NeonHttpDatabase<Schema> | null = null;

function getDb(): NeonHttpDatabase<Schema> {
  if (!_db) {
    const url = process.env.DATABASE_URL!;
    _db = isNeonUrl(url)
      ? drizzle(neon(url), { schema })
      : (drizzleNodePg(url, { schema }) as unknown as NeonHttpDatabase<Schema>);
  }
  return _db;
}

// Lazy proxy so importing this module never touches DATABASE_URL at build time.
export const db = new Proxy({} as NeonHttpDatabase<Schema>, {
  get(_target, prop) {
    return getDb()[prop as keyof NeonHttpDatabase<Schema>];
  },
});
