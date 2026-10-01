import { and, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { STAGES } from "@/lib/stages";
import { db } from "@/lib/db";
import { clients, cmClientDomains, cmClientUsers, cmCreatorSideSenders, cmCreators, cmGmailAccounts, cmOutreachEvents, cmPartnerships, users } from "@/lib/db/schema";
import { FREE_MAIL_DOMAINS, normAddress } from "@/lib/email-ingest";
import { displayNames } from "@/lib/email-body";
import { emailDomain } from "@/lib/gmail";

/**
 * Settings → client team, the parts that aren't a person (2026-09-30):
 *  - whole domains at a client — everyone at @partner.com counts as the
 *    client's on that client's creators (email-ingest classifyMessage);
 *  - people on creators' threads nobody has placed yet, so a teammate can say
 *    "they're HELLA's" or "they're with the creator" without typing addresses.
 */

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "");
}

export function listClientDomains(clientId: string) {
  return db
    .select({ id: cmClientDomains.id, domain: cmClientDomains.domain })
    .from(cmClientDomains)
    .where(eq(cmClientDomains.clientId, clientId))
    .orderBy(cmClientDomains.domain);
}

/** The agency's own domains: the mailbox's, every login's, and every "Our side" @domain — never a client's. */
async function ourDomains(): Promise<Set<string>> {
  const [logins, accounts] = await Promise.all([
    db.select({ email: users.email }).from(users),
    db.select({ email: cmGmailAccounts.email, team: cmGmailAccounts.teamAddresses }).from(cmGmailAccounts),
  ]);
  const out = new Set<string>();
  for (const l of logins) out.add(emailDomain(l.email));
  for (const a of accounts) {
    out.add(emailDomain(a.email));
    for (const e of a.team ?? []) if (e.startsWith("@")) out.add(e.slice(1).toLowerCase());
  }
  for (const d of FREE_MAIL_DOMAINS) out.delete(d);
  out.delete("");
  return out;
}

export async function addClientDomain(clientId: string, raw: string): Promise<{ ok: true; id: string; domain: string } | { ok: false; error: string }> {
  const domain = normalizeDomain(raw);
  if (!DOMAIN.test(domain)) return { ok: false, error: "That doesn't look like a domain. Use one like partner.com." };
  if (FREE_MAIL_DOMAINS.has(domain)) return { ok: false, error: `@${domain} is free mail, so it can't be a whole team — add the person instead.` };
  if ((await ourDomains()).has(domain)) return { ok: false, error: `@${domain} is the agency's own (or on Our side) — it can't be a client's.` };
  const [taken] = await db.select({ clientId: cmClientDomains.clientId }).from(cmClientDomains).where(eq(cmClientDomains.domain, domain)).limit(1);
  if (taken) return { ok: false, error: taken.clientId === clientId ? `@${domain} is already on this list.` : `@${domain} is already on another client's team.` };
  const [row] = await db.insert(cmClientDomains).values({ clientId, domain }).onConflictDoNothing().returning({ id: cmClientDomains.id });
  if (!row) return { ok: false, error: `@${domain} is already on a client's team.` };
  return { ok: true, id: row.id, domain };
}

/**
 * An "Our side" @domain that's already a client's (review 2026-09-30): saving
 * it would make that client's people count as us on every other client's
 * creators while their own stored mail stayed theirs. The first clash, or null.
 */
export async function clientDomainClash(ourSide: string[]): Promise<{ domain: string; clientName: string } | null> {
  const domains = [...new Set(ourSide.filter((e) => e.trim().startsWith("@")).map(normalizeDomain))];
  if (!domains.length) return null;
  const [hit] = await db
    .select({ domain: cmClientDomains.domain, clientName: clients.name })
    .from(cmClientDomains)
    .innerJoin(clients, eq(clients.id, cmClientDomains.clientId))
    .where(inArray(cmClientDomains.domain, domains))
    .limit(1);
  return hit ?? null;
}

/** Scoped to the client, so a stray id can't touch another client's list. */
export async function removeClientDomain(clientId: string, id: string): Promise<boolean> {
  const r = await db.delete(cmClientDomains).where(and(eq(cmClientDomains.id, id), eq(cmClientDomains.clientId, clientId))).returning({ id: cmClientDomains.id });
  return r.length > 0;
}

export interface UnknownSender {
  email: string;
  name: string | null;
  domain: string;
  /** False for free mail: only the person can be added, never the whole domain. */
  domainAllowed: boolean;
  messages: number;
  lastAt: Date;
  /** The creators whose threads they wrote on (up to three). */
  creatorNames: string[];
}

/**
 * Everyone who wrote on this client's creators' threads as "someone else",
 * newest first. Left out: invites and robots (notes); anyone already placed —
 * with the creator, on any client's team, or at any client's domain — even
 * before their stored mail is re-sorted, so the list is right the moment a
 * button is pressed (review 2026-09-30).
 */
export async function unknownSenders(clientId: string, limit = 12): Promise<UnknownSender[]> {
  const rows = await db
    .select({ from: cmOutreachEvents.fromAddress, at: cmOutreachEvents.occurredAt, creatorName: cmCreators.name })
    .from(cmOutreachEvents)
    .innerJoin(cmPartnerships, eq(cmPartnerships.id, cmOutreachEvents.partnershipId))
    .innerJoin(cmCreators, eq(cmCreators.id, cmPartnerships.creatorId))
    .where(
      and(
        eq(cmCreators.clientId, clientId),
        eq(cmOutreachEvents.senderRole, "other"),
        eq(cmOutreachEvents.channel, "email"),
        ne(cmOutreachEvents.kind, "note"),
        sql`${cmOutreachEvents.fromAddress} is not null`,
      ),
    )
    .orderBy(desc(cmOutreachEvents.occurredAt))
    .limit(500);
  const by = new Map<string, UnknownSender>();
  for (const r of rows) {
    const email = normAddress(r.from!);
    const seen = by.get(email);
    if (seen) {
      seen.messages++;
      if (seen.creatorNames.length < 3 && !seen.creatorNames.includes(r.creatorName)) seen.creatorNames.push(r.creatorName);
      continue;
    }
    const domain = emailDomain(email);
    const name = displayNames(r.from);
    by.set(email, { email, name: name && name !== email ? name : null, domain, domainAllowed: !FREE_MAIL_DOMAINS.has(domain), messages: 1, lastAt: r.at, creatorNames: [r.creatorName] });
  }
  if (!by.size) return [];
  const emails = [...by.keys()];
  const [sided, people, domains] = await Promise.all([
    db.select({ email: cmCreatorSideSenders.email }).from(cmCreatorSideSenders).where(inArray(cmCreatorSideSenders.email, emails)),
    db.select({ email: cmClientUsers.email }).from(cmClientUsers).where(inArray(cmClientUsers.email, emails)),
    db.select({ domain: cmClientDomains.domain }).from(cmClientDomains).where(inArray(cmClientDomains.domain, [...new Set(emails.map(emailDomain))])),
  ]);
  for (const p of [...sided, ...people]) by.delete(p.email);
  const placedDomains = new Set(domains.map((d) => d.domain));
  for (const [email, s] of by) if (placedDomains.has(s.domain)) by.delete(email);
  return [...by.values()].slice(0, limit);
}

/**
 * "With the creator": they stay someone else's messages; the reader is told
 * whose side they're on. Global on purpose — a creator's manager is theirs on
 * every brand's thread.
 */
export async function markCreatorSide(raw: string): Promise<string> {
  const email = normAddress(raw);
  await db.insert(cmCreatorSideSenders).values({ email }).onConflictDoNothing();
  await rereadThreadsFrom(email);
  return email;
}

export async function unmarkCreatorSide(raw: string): Promise<void> {
  const email = normAddress(raw);
  await db.delete(cmCreatorSideSenders).where(eq(cmCreatorSideSenders.email, email));
  await rereadThreadsFrom(email);
}

/** The conversations they wrote on are read again, so the reader sees the new label. */
async function rereadThreadsFrom(email: string) {
  // Narrowed in SQL by the domain, then matched exactly the way the list groups them (normAddress).
  // Live deals only: a closed one has nothing for the reader to decide, and each read costs a model call.
  const domainLike = `%@${emailDomain(email).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db
    .select({ partnershipId: cmOutreachEvents.partnershipId, from: cmOutreachEvents.fromAddress })
    .from(cmOutreachEvents)
    .innerJoin(cmPartnerships, eq(cmPartnerships.id, cmOutreachEvents.partnershipId))
    .where(
      and(
        eq(cmOutreachEvents.senderRole, "other"),
        sql`lower(${cmOutreachEvents.fromAddress}) like ${domainLike}`,
        notInArray(cmPartnerships.stage, STAGES.filter((s) => s.terminal).map((s) => s.value)),
      ),
    );
  const ids = [...new Set(rows.filter((r) => normAddress(r.from!) === email).map((r) => r.partnershipId))];
  if (ids.length) await db.update(cmPartnerships).set({ emailAssessedAt: null }).where(inArray(cmPartnerships.id, ids));
}
