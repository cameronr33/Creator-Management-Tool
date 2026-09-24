import { createHash, randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmClientUsers, users } from "@/lib/db/schema";

/**
 * People at a client (HELLA staff and the like). Every one is a client
 * contact for email; any of them can be invited to their own login, which
 * only ever shows their brand's portal.
 *
 * Invites: a random one-time token, sent by the agency (the app never sends
 * mail). Only its sha256 is stored, it expires after 7 days, and the person
 * sets their own password — nobody else ever sees it.
 */

export const INVITE_DAYS = 7;
export const MIN_PASSWORD = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function listClientUsers(clientId: string) {
  return db
    .select({
      id: cmClientUsers.id,
      name: cmClientUsers.name,
      email: cmClientUsers.email,
      loginEnabled: cmClientUsers.loginEnabled,
      hasPassword: sql<boolean>`${cmClientUsers.passwordHash} is not null`,
      inviteExpiresAt: cmClientUsers.inviteExpiresAt,
      lastLoginAt: cmClientUsers.lastLoginAt,
    })
    .from(cmClientUsers)
    .where(eq(cmClientUsers.clientId, clientId))
    .orderBy(asc(cmClientUsers.name));
}

export async function addClientUser(clientId: string, name: string, rawEmail: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const email = rawEmail.trim().toLowerCase();
  const n = name.trim();
  if (!n) return { ok: false, error: "Add their name" };
  if (!EMAIL.test(email)) return { ok: false, error: `"${rawEmail}" isn't an email address` };
  const [agency] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (agency) return { ok: false, error: "That address already signs in as part of the agency" };
  const [taken] = await db.select({ id: cmClientUsers.id }).from(cmClientUsers).where(eq(cmClientUsers.email, email)).limit(1);
  if (taken) return { ok: false, error: "That person is already on a client team" };
  const [row] = await db.insert(cmClientUsers).values({ clientId, name: n, email }).returning({ id: cmClientUsers.id });
  return { ok: true, id: row.id };
}

/** Scoped to the client, so a stray id can't touch another client's person. */
export async function removeClientUser(clientId: string, id: string): Promise<boolean> {
  const r = await db.delete(cmClientUsers).where(and(eq(cmClientUsers.id, id), eq(cmClientUsers.clientId, clientId))).returning({ id: cmClientUsers.id });
  return r.length > 0;
}

/** A fresh one-time invite link token (any older one stops working). Returns the raw token — shown once. */
export async function createInvite(clientId: string, id: string, now = new Date()): Promise<string | null> {
  const token = randomBytes(24).toString("base64url");
  const r = await db
    .update(cmClientUsers)
    .set({ inviteTokenHash: hashInviteToken(token), inviteExpiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000) })
    .where(and(eq(cmClientUsers.id, id), eq(cmClientUsers.clientId, clientId)))
    .returning({ id: cmClientUsers.id });
  return r.length ? token : null;
}

/** Turn their login off: password and any open invite are cleared. They stay a contact. */
export async function revokeLogin(clientId: string, id: string): Promise<boolean> {
  const r = await db
    .update(cmClientUsers)
    .set({ loginEnabled: false, passwordHash: null, inviteTokenHash: null, inviteExpiresAt: null })
    .where(and(eq(cmClientUsers.id, id), eq(cmClientUsers.clientId, clientId)))
    .returning({ id: cmClientUsers.id });
  return r.length > 0;
}

/** Who an unexpired invite is for, or null. */
export async function findInvite(token: string, now = new Date()) {
  if (!token || token.length < 20) return null;
  const [row] = await db
    .select({ id: cmClientUsers.id, name: cmClientUsers.name, email: cmClientUsers.email })
    .from(cmClientUsers)
    .where(and(eq(cmClientUsers.inviteTokenHash, hashInviteToken(token)), gt(cmClientUsers.inviteExpiresAt, now)))
    .limit(1);
  return row ?? null;
}

/** Set their password from an invite; the invite is used up. */
export async function acceptInvite(token: string, password: string, now = new Date()): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  if (password.length < MIN_PASSWORD) return { ok: false, error: `Use at least ${MIN_PASSWORD} characters` };
  const person = await findInvite(token, now);
  if (!person) return { ok: false, error: "This invite link has expired or was already used — ask for a new one." };
  const r = await db
    .update(cmClientUsers)
    .set({ passwordHash: await hash(password, 10), loginEnabled: true, inviteTokenHash: null, inviteExpiresAt: null })
    // Compare-and-set on the token so the same link can't be used twice at once.
    .where(and(eq(cmClientUsers.id, person.id), eq(cmClientUsers.inviteTokenHash, hashInviteToken(token))))
    .returning({ id: cmClientUsers.id });
  return r.length ? { ok: true, email: person.email } : { ok: false, error: "This invite link was already used." };
}
