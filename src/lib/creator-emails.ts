import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmCreatorEmails } from "@/lib/db/schema";

/**
 * Every address a creator is known to write from, besides their public
 * business email. The email check searches the mailbox for exactly these
 * addresses (plus businessEmail) and nothing else — entering an address here
 * is what starts a creator's email being tracked.
 */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Manual add on the creator page (source "manual"). */
export async function addCreatorEmail(creatorId: string, rawEmail: string, source = "manual") {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_RE.test(email)) throw new Error("Invalid email address");
  await db.insert(cmCreatorEmails).values({ creatorId, email, source }).onConflictDoNothing();
  return email;
}

export async function removeCreatorEmail(creatorId: string, email: string): Promise<void> {
  await db
    .delete(cmCreatorEmails)
    .where(and(eq(cmCreatorEmails.creatorId, creatorId), eq(cmCreatorEmails.email, normalizeEmail(email))));
}

export async function getCreatorEmails(creatorId: string) {
  return db
    .select()
    .from(cmCreatorEmails)
    .where(eq(cmCreatorEmails.creatorId, creatorId))
    .orderBy(cmCreatorEmails.createdAt);
}
