import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, cmClientUsers } from "@/lib/db/schema";

/**
 * A client login is re-checked against the database on every request — a
 * signed token alone isn't enough (security review, 2026-09-24): turning a
 * login off, removing the person, a new password, or the brand being retired
 * ends every session they already have. The token carries a fingerprint of
 * the password hash at sign-in; any change to it no longer matches.
 */

export function passwordVersion(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);
}

export interface ClientPersonSession {
  user?: { id?: string; kind?: string; clientId?: string | null; pwv?: string | null } | null;
}

/** The person behind a client session, if that login is still valid; otherwise null. */
export async function activeClientPerson(session: ClientPersonSession | null | undefined): Promise<{ id: string; name: string; clientId: string } | null> {
  const u = session?.user;
  if (!u || u.kind !== "client" || !u.id || !u.clientId || !u.pwv) return null;
  const [row] = await db
    .select({ id: cmClientUsers.id, name: cmClientUsers.name, clientId: cmClientUsers.clientId, loginEnabled: cmClientUsers.loginEnabled, passwordHash: cmClientUsers.passwordHash, clientActive: clients.isActive })
    .from(cmClientUsers)
    .innerJoin(clients, eq(clients.id, cmClientUsers.clientId))
    .where(and(eq(cmClientUsers.id, u.id), eq(cmClientUsers.clientId, u.clientId)))
    .limit(1);
  if (!row || !row.loginEnabled || !row.passwordHash || !row.clientActive) return null;
  if (passwordVersion(row.passwordHash) !== u.pwv) return null;
  return { id: row.id, name: row.name, clientId: row.clientId };
}
