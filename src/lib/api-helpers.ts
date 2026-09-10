/**
 * Shared helpers for API route handlers.
 */

import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { cmApiKeys, cmCreators, cmPartnerships } from "@/lib/db/schema";
import { resolveClient } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";

/** Returns the session or a 401 response. */
export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    return {
      session: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { session, error: null };
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Authenticates a machine caller (the creator-research skill) via
 * `Authorization: Bearer <key>`. Stamps lastUsedAt at most once an hour —
 * the research queue is polled, and a write per poll is pure amplification.
 */
export async function requireApiKey(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const raw = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!raw) {
    return {
      apiKey: null,
      error: NextResponse.json(
        { error: "Missing Authorization: Bearer <key>" },
        { status: 401 },
      ),
    };
  }

  const [key] = await db
    .select()
    .from(cmApiKeys)
    .where(and(eq(cmApiKeys.keyHash, hashApiKey(raw)), isNull(cmApiKeys.revokedAt)))
    .limit(1);

  if (!key) {
    return {
      apiKey: null,
      error: NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 }),
    };
  }

  const staleAfter = new Date(Date.now() - 60 * 60 * 1000);
  if (!key.lastUsedAt || key.lastUsedAt < staleAfter) {
    await db
      .update(cmApiKeys)
      .set({ lastUsedAt: sql`now()` })
      .where(
        and(
          eq(cmApiKeys.id, key.id),
          or(isNull(cmApiKeys.lastUsedAt), lt(cmApiKeys.lastUsedAt, staleAfter)),
        ),
      );
  }

  return { apiKey: key, error: null };
}

/** Guards the /api/cron/* routes, which the Railway worker calls. Constant-time compare. */
export function requireCronSecret(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

export function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate a path id up front so a junk id is a 400, not a Postgres uuid error. */
export function isUuid(id: string): boolean {
  return UUID_RE.test(id);
}

/**
 * Cross-client guard for partnership mutations. The browser always works
 * inside one selected client (cookie); a partnership id from another client —
 * a stale tab, a pasted link — must 404 rather than silently mutate the
 * wrong client's deal. All users are agency staff, so this is a blast-radius
 * limit, not an access-control boundary.
 */
export async function assertPartnershipInSelectedClient(partnershipId: string) {
  if (!isUuid(partnershipId)) return badRequest("Invalid partnership id");
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) return notFound("No client selected");
  const [row] = await db
    .select({ clientId: cmCreators.clientId })
    .from(cmPartnerships)
    .innerJoin(cmCreators, eq(cmPartnerships.creatorId, cmCreators.id))
    .where(eq(cmPartnerships.id, partnershipId))
    .limit(1);
  if (!row) return notFound("Partnership not found");
  if (row.clientId !== client.id) return notFound("Partnership belongs to a different client");
  return null;
}

/** Same guard for creator-level mutations. */
export async function assertCreatorInSelectedClient(creatorId: string) {
  if (!isUuid(creatorId)) return badRequest("Invalid creator id");
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) return notFound("No client selected");
  const [row] = await db
    .select({ clientId: cmCreators.clientId })
    .from(cmCreators)
    .where(eq(cmCreators.id, creatorId))
    .limit(1);
  if (!row) return notFound("Creator not found");
  if (row.clientId !== client.id) return notFound("Creator belongs to a different client");
  return null;
}
