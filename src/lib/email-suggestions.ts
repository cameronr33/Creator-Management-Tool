import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  clients,
  cmCreators,
  cmCreatorEmails,
  cmEmailSuggestions,
  type CmEmailSuggestion,
} from "@/lib/db/schema";

/**
 * Address discovery for the email sync.
 *
 * The sync can only match threads to creators by addresses the app knows.
 * Those come from Apify's public-email field and are often NOT what a creator
 * actually replies from — so a sync can report "ok" forever while capturing
 * nothing. Discovery scans the cc'd outreach threads themselves, records every
 * external address that matches no creator, and proposes a creator by name
 * similarity. The operator confirms with one click, which writes a
 * cm_creator_emails row and makes that creator's threads start syncing.
 */

export interface ObservedAddress {
  email: string;
  displayName: string | null;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  sampleSubject: string | null;
}

export interface CreatorNameRef {
  id: string;
  name: string;
  username: string;
}

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

/**
 * Pure heuristic: propose a creator for an observed address, or nothing.
 *
 * The bar is deliberately high. A suggestion that looks confident and is
 * wrong is worse than no suggestion, because the operator clicks Link and
 * files a stranger's emails against a creator. Real examples this rejects:
 * "Eric Muehlstein" must NOT match creator "Eric Kendricks"; "Lee Severino"
 * must NOT match "Keaton Lee" — one shared common name is not evidence.
 *
 * Accept only when:
 *   - the creator's handle (4+ chars) appears in the address local part, OR
 *   - TWO OR MORE distinct name tokens match (i.e. first AND last name).
 * Ties are rejected — a human decides.
 */
export function suggestCreatorForAddress(
  email: string,
  displayName: string | null,
  creators: CreatorNameRef[],
): CreatorNameRef | null {
  const local = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  const displayTokens = new Set(
    (displayName ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3),
  );

  const scored = creators.map((creator) => {
    const tokens = nameTokens(creator.name);
    const matched = tokens.filter((t) => displayTokens.has(t) || local.includes(t)).length;
    const handle = creator.username.toLowerCase().replace(/[^a-z0-9]/g, "");
    const handleHit = handle.length >= 4 && local.includes(handle);
    // Handle hits are near-conclusive; two name tokens is the other way in.
    const score = handleHit ? 10 + matched : matched >= 2 ? matched : 0;
    return { creator, score };
  });

  const best = scored.reduce((a, b) => (b.score > a.score ? b : a), { creator: creators[0], score: 0 });
  if (best.score === 0) return null;
  const contenders = scored.filter((x) => x.score === best.score);
  if (contenders.length > 1) return null; // ambiguous — a human decides
  return best.creator;
}

/** Every creator across all clients — suggestions aren't client-scoped. */
export async function getAllCreatorRefs(): Promise<(CreatorNameRef & { clientName: string })[]> {
  return db
    .select({
      id: cmCreators.id,
      name: cmCreators.name,
      username: cmCreators.username,
      clientName: clients.name,
    })
    .from(cmCreators)
    .innerJoin(clients, eq(cmCreators.clientId, clients.id))
    .orderBy(clients.name, cmCreators.name);
}

/**
 * Upsert observed addresses. Counts and last-seen refresh on every run;
 * status (linked/ignored) is never reset by a re-scan.
 */
export async function recordSuggestions(
  observed: ObservedAddress[],
  creators: CreatorNameRef[],
): Promise<void> {
  for (const o of observed) {
    const suggested = suggestCreatorForAddress(o.email, o.displayName, creators);
    await db
      .insert(cmEmailSuggestions)
      .values({
        email: o.email,
        displayName: o.displayName,
        messageCount: o.count,
        firstSeenAt: o.firstSeenAt,
        lastSeenAt: o.lastSeenAt,
        sampleSubject: o.sampleSubject,
        suggestedCreatorId: suggested?.id ?? null,
      })
      .onConflictDoUpdate({
        target: cmEmailSuggestions.email,
        set: {
          messageCount: sql`greatest(${cmEmailSuggestions.messageCount}, excluded.message_count)`,
          lastSeenAt: sql`greatest(${cmEmailSuggestions.lastSeenAt}, excluded.last_seen_at)`,
          firstSeenAt: sql`least(${cmEmailSuggestions.firstSeenAt}, excluded.first_seen_at)`,
          displayName: sql`coalesce(excluded.display_name, ${cmEmailSuggestions.displayName})`,
          sampleSubject: sql`coalesce(${cmEmailSuggestions.sampleSubject}, excluded.sample_subject)`,
          // Always recompute: an improved heuristic must be able to correct
          // a previous wrong guess on a row nobody has acted on yet.
          suggestedCreatorId: sql`excluded.suggested_creator_id`,
          updatedAt: new Date(),
        },
      });
  }
}

export interface OpenSuggestion extends CmEmailSuggestion {
  suggestedCreatorName: string | null;
}

export async function listOpenSuggestions(limit = 50, offset = 0): Promise<OpenSuggestion[]> {
  const rows = await db
    .select({
      suggestion: cmEmailSuggestions,
      suggestedCreatorName: cmCreators.name,
    })
    .from(cmEmailSuggestions)
    .leftJoin(cmCreators, eq(cmEmailSuggestions.suggestedCreatorId, cmCreators.id))
    .where(eq(cmEmailSuggestions.status, "open"))
    // Auto-matched first, then personal mail providers — creators overwhelmingly
    // write from gmail, while corporate domains are usually client staff and
    // vendors the operator will Ignore.
    .orderBy(
      sql`case when ${cmEmailSuggestions.suggestedCreatorId} is not null then 0
               when split_part(${cmEmailSuggestions.email}, '@', 2) in
                 ('gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','aol.com','me.com','proton.me') then 1
               else 2 end`,
      desc(cmEmailSuggestions.messageCount),
      desc(cmEmailSuggestions.lastSeenAt),
      cmEmailSuggestions.id,
    )
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({ ...r.suggestion, suggestedCreatorName: r.suggestedCreatorName ?? null }));
}

export async function countOpenSuggestions(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cmEmailSuggestions)
    .where(eq(cmEmailSuggestions.status, "open"));
  return row?.n ?? 0;
}

/** Link an address to a creator: writes cm_creator_emails, marks the suggestion. */
export async function linkSuggestion(id: string, creatorId: string): Promise<CmEmailSuggestion | null> {
  const [s] = await db.select().from(cmEmailSuggestions).where(eq(cmEmailSuggestions.id, id)).limit(1);
  if (!s) return null;
  await db
    .insert(cmCreatorEmails)
    .values({ creatorId, email: s.email, source: "sync" })
    .onConflictDoNothing();
  const [updated] = await db
    .update(cmEmailSuggestions)
    .set({ status: "linked", linkedCreatorId: creatorId, updatedAt: new Date() })
    .where(eq(cmEmailSuggestions.id, id))
    .returning();
  return updated ?? null;
}

export async function ignoreSuggestion(id: string): Promise<boolean> {
  const res = await db
    .update(cmEmailSuggestions)
    .set({ status: "ignored", updatedAt: new Date() })
    .where(and(eq(cmEmailSuggestions.id, id), eq(cmEmailSuggestions.status, "open")))
    .returning({ id: cmEmailSuggestions.id });
  return res.length > 0;
}

/** Manual add on the creator page (source "manual"). */
export async function addCreatorEmail(creatorId: string, rawEmail: string, source = "manual") {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email address");
  await db.insert(cmCreatorEmails).values({ creatorId, email, source }).onConflictDoNothing();
  // A previously ignored/open suggestion for this address is now resolved.
  await db
    .update(cmEmailSuggestions)
    .set({ status: "linked", linkedCreatorId: creatorId, updatedAt: new Date() })
    .where(eq(cmEmailSuggestions.email, email));
  return email;
}

export async function removeCreatorEmail(creatorId: string, email: string): Promise<void> {
  await db
    .delete(cmCreatorEmails)
    .where(and(eq(cmCreatorEmails.creatorId, creatorId), eq(cmCreatorEmails.email, email.toLowerCase())));
}

export async function getCreatorEmails(creatorId: string) {
  return db
    .select()
    .from(cmCreatorEmails)
    .where(eq(cmCreatorEmails.creatorId, creatorId))
    .orderBy(cmCreatorEmails.createdAt);
}
