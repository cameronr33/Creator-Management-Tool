/**
 * Shared helpers for API route handlers.
 */

import { timingSafeEqual } from "crypto";
import { UserError, userMessage } from "@/lib/user-error";
import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { cmCampaigns, cmCreators, cmPartnerships } from "@/lib/db/schema";
import { resolveClient } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { activeClientPerson } from "@/lib/client-session";

/** A session that belongs to someone at a client (the portal), not the agency. */
export function isClientSession(session: { user?: { kind?: string } } | null | undefined): boolean {
  return session?.user?.kind === "client";
}

/**
 * The agency's guard — every route and action outside the portal. Returns the
 * session, a 401 when signed out, or a 403 for a client login (which may only
 * use /api/client/*).
 */
export async function requireAgency() {
  const session = await auth();
  if (!session?.user) {
    return {
      session: null,
      error: NextResponse.json({ error: "You've been signed out. Sign in again, then try that once more." }, { status: 401 }),
    };
  }
  if (isClientSession(session)) {
    return { session: null, error: NextResponse.json({ error: "That isn't available from the client portal." }, { status: 403 }) };
  }
  return { session, error: null };
}

/**
 * The portal's guard — /api/client/* only. The client comes from the login
 * itself, never from a cookie or the request, so a client person can only
 * ever reach their own brand.
 */
export async function requireClientUser() {
  const session = await auth();
  // Re-checked in the database every time: a login turned off, removed or re-invited ends at once.
  const person = isClientSession(session) ? await activeClientPerson(session) : null;
  if (!person) {
    return { person: null, error: NextResponse.json({ error: "You've been signed out. Sign in again, then try that once more." }, { status: 401 }) };
  }
  return { person, error: null };
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
    return NextResponse.json({ error: "Missing or wrong cron secret" }, { status: 401 });
  }
  return null;
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

/**
 * A caught error as a response: a UserError's own words, or — for anything
 * else — the fallback, with the real error in the server log.
 */
export function errorResponse(e: unknown, fallback: string) {
  const message = userMessage(e, fallback);
  return e instanceof UserError ? badRequest(message) : NextResponse.json({ error: message }, { status: 500 });
}

export function notFound(message = "That isn't here any more. Reload the page.") {
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
  if (!isUuid(partnershipId)) return badRequest("This creator isn't in the client you have selected. Reload the page.");
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) return notFound("Pick a client in the sidebar first.");
  const [row] = await db
    .select({ clientId: cmCreators.clientId })
    .from(cmPartnerships)
    .innerJoin(cmCreators, eq(cmPartnerships.creatorId, cmCreators.id))
    .where(eq(cmPartnerships.id, partnershipId))
    .limit(1);
  if (!row) return notFound("This creator isn't here any more — they may have been removed. Reload the page.");
  if (row.clientId !== client.id) return notFound("This creator isn't in the client you have selected. Reload the page.");
  return null;
}

/** Same guard for creator-level mutations. */
export async function assertCreatorInSelectedClient(creatorId: string) {
  if (!isUuid(creatorId)) return badRequest("This creator isn't in the client you have selected. Reload the page.");
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) return notFound("Pick a client in the sidebar first.");
  const [row] = await db
    .select({ clientId: cmCreators.clientId })
    .from(cmCreators)
    .where(eq(cmCreators.id, creatorId))
    .limit(1);
  if (!row) return notFound("This creator isn't here any more. Reload the page.");
  if (row.clientId !== client.id) return notFound("This creator isn't in the client you have selected. Reload the page.");
  return null;
}

/** The body names a client: it must be the one selected in the sidebar. */
export async function assertClientIsSelected(clientId: string) {
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) return notFound("Pick a client in the sidebar first.");
  if (client.id !== clientId) return notFound("That client isn't the one selected — reload the page");
  return null;
}

/** Many partnerships at once (bulk actions): every one must be in the selected client. */
export async function assertPartnershipsInSelectedClient(ids: string[]) {
  if (ids.length === 0) return badRequest("Nothing selected");
  if (!ids.every(isUuid)) return badRequest("Some of those creators aren't in the client you have selected. Reload the page.");
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) return notFound("Pick a client in the sidebar first.");
  const rows = await db
    .select({ id: cmPartnerships.id, clientId: cmCreators.clientId })
    .from(cmPartnerships)
    .innerJoin(cmCreators, eq(cmPartnerships.creatorId, cmCreators.id))
    .where(inArray(cmPartnerships.id, ids));
  if (rows.length !== new Set(ids).size) return notFound("Some of those creators no longer exist — reload the page");
  if (rows.some((r) => r.clientId !== client.id)) return notFound("Some of those belong to a different client");
  return null;
}

/** A campaign id from the body must belong to the selected client. */
export async function assertCampaignInSelectedClient(campaignId: string) {
  if (!isUuid(campaignId)) return badRequest("That campaign isn't here any more. Reload the page.");
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) return notFound("Pick a client in the sidebar first.");
  const [row] = await db.select({ clientId: cmCampaigns.clientId }).from(cmCampaigns).where(eq(cmCampaigns.id, campaignId)).limit(1);
  if (!row) return notFound("That campaign isn't here any more. Reload the page.");
  if (row.clientId !== client.id) return notFound("That campaign isn't in the client you have selected. Reload the page.");
  return null;
}
