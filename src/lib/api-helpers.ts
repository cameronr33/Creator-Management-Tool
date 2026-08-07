/**
 * Shared helpers for API route handlers.
 */

import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { cmApiKeys } from "@/lib/db/schema";

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
 * `Authorization: Bearer <key>`. Records lastUsedAt on success.
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

  await db
    .update(cmApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(cmApiKeys.id, key.id));

  return { apiKey: key, error: null };
}

/** Guards the /api/cron/* routes, which the Railway worker calls. */
export function requireCronSecret(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const header = request.headers.get("authorization") ?? "";
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status: 400 });
}
