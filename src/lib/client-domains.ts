import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmClientDomains, cmCreatorSideSenders, cmCreators, cmGmailAccounts, cmOutreachEvents, cmPartnerships, users } from "@/lib/db/schema";
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

/** Everyone who wrote on this client's creators' threads as "someone else", newest first, minus those placed with the creator. */
export async function unknownSenders(clientId: string, limit = 12): Promise<UnknownSender[]> {
  const rows = await db
    .select({ from: cmOutreachEvents.fromAddress, at: cmOutreachEvents.occurredAt, creatorName: cmCreators.name })
    .from(cmOutreachEvents)
    .innerJoin(cmPartnerships, eq(cmPartnerships.id, cmOutreachEvents.partnershipId))
    .innerJoin(cmCreators, eq(cmCreators.id, cmPartnerships.creatorId))
    .where(and(eq(cmCreators.clientId, clientId), eq(cmOutreachEvents.senderRole, "other"), eq(cmOutreachEvents.channel, "email"), sql`${cmOutreachEvents.fromAddress} is not null`))
    .orderBy(desc(cmOutreachEvents.occurredAt));
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
  const placed = await db.select({ email: cmCreatorSideSenders.email }).from(cmCreatorSideSenders).where(inArray(cmCreatorSideSenders.email, [...by.keys()]));
  for (const p of placed) by.delete(p.email);
  return [...by.values()].slice(0, limit);
}

/** "With the creator": they stay someone else's messages; the reader is told whose side they're on. */
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
  // The header is "Name <addr>" or the bare address; LIKE's own wildcards in the address are escaped.
  const bracketed = `%<${email.replace(/[\\%_]/g, (c) => `\\${c}`)}>`;
  await db.execute(sql`
    update ${cmPartnerships} set email_assessed_at = null
    where id in (
      select e.partnership_id from ${cmOutreachEvents} e
      where e.sender_role = 'other' and (lower(trim(e.from_address)) = ${email} or lower(e.from_address) like ${bracketed})
    )
  `);
}
