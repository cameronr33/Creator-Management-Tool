import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  clients,
  cmCreators,
  cmCreatorEmails,
  cmPartnerships,
  cmOutreachEvents,
} from "@/lib/db/schema";
import { applyAutoStage } from "@/lib/auto-stage";
import { cleanEmailBody } from "@/lib/email-body";

/**
 * Server side of the Gmail sync (Track B). The sync skill sends raw Gmail
 * facts; ALL matching logic lives here so the skill stays dumb and the rules
 * are unit-testable.
 *
 * Coverage caveat (documented in the skill + README): only threads where the
 * cc'd mailbox appears can be synced — a creator reply that doesn't
 * reply-all is invisible to this pipeline.
 */

/**
 * Stages the email sync ignores. `no_response` is deliberately NOT here: the
 * follow-up loop closes creators who went quiet, and their late reply is
 * exactly the message we most want to catch — so they stay on the roster and
 * an inbound message reopens them (see auto-stage `inbound_message`).
 */
const ROSTER_EXCLUDED_STAGES = ["passed", "declined"] as const;

export interface EmailRosterContact {
  partnershipId: string;
  creatorId: string;
  clientSlug: string;
  name: string;
  username: string;
  businessEmail: string;
  stage: string;
}

/**
 * Every known address of every creator with an open (non-terminal)
 * partnership — one contact row per (creator, address). Addresses are the
 * union of the Apify-scraped businessEmail and cm_creator_emails (linked
 * from sync discovery or added by hand), because the public address is
 * frequently not the one a creator actually writes from.
 */
export async function getEmailRoster(): Promise<EmailRosterContact[]> {
  const rows = await db
    .select({
      partnershipId: cmPartnerships.id,
      creatorId: cmCreators.id,
      clientSlug: clients.slug,
      name: cmCreators.name,
      username: cmCreators.username,
      businessEmail: cmCreators.businessEmail,
      stage: cmPartnerships.stage,
      updatedAt: cmPartnerships.updatedAt,
    })
    .from(cmPartnerships)
    .innerJoin(cmCreators, eq(cmPartnerships.creatorId, cmCreators.id))
    .innerJoin(clients, eq(cmCreators.clientId, clients.id))
    .where(notInArray(cmPartnerships.stage, [...ROSTER_EXCLUDED_STAGES]))
    .orderBy(desc(cmPartnerships.updatedAt));

  // One partnership per creator — the most recently updated open one wins.
  const byCreator = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!byCreator.has(r.creatorId)) byCreator.set(r.creatorId, r);
  if (byCreator.size === 0) return [];

  const extra = await db
    .select({ creatorId: cmCreatorEmails.creatorId, email: cmCreatorEmails.email })
    .from(cmCreatorEmails)
    .where(inArray(cmCreatorEmails.creatorId, [...byCreator.keys()]));
  const extraByCreator = new Map<string, string[]>();
  for (const e of extra) {
    const list = extraByCreator.get(e.creatorId) ?? [];
    list.push(e.email);
    extraByCreator.set(e.creatorId, list);
  }

  const contacts: EmailRosterContact[] = [];
  for (const r of byCreator.values()) {
    const addresses = new Set<string>();
    if (r.businessEmail) addresses.add(r.businessEmail.toLowerCase());
    for (const e of extraByCreator.get(r.creatorId) ?? []) addresses.add(e.toLowerCase());
    for (const businessEmail of addresses) {
      contacts.push({
        partnershipId: r.partnershipId,
        creatorId: r.creatorId,
        clientSlug: r.clientSlug,
        name: r.name,
        username: r.username,
        businessEmail,
        stage: r.stage,
      });
    }
  }
  return contacts;
}

export interface IncomingEmailMessage {
  /** Gmail message id — the idempotency key. */
  externalId: string;
  threadId: string | null;
  occurredAt: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string | null;
  bodyText: string | null;
}

export interface EmailMatch {
  partnershipId: string;
  direction: "inbound" | "outbound";
}

function normAddress(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return (m ? m[1] : addr).trim().toLowerCase();
}

/**
 * Pure matcher. A message FROM a creator address is inbound. A message TO/cc
 * a creator is outbound only when it was actually sent by the team — the
 * sender's domain must match `teamDomain` (the connected mailbox's domain).
 * Without that check a creator's manager cc'ing them would be logged as our
 * follow-up and silently advance the pipeline. When no teamDomain is known
 * (no mailbox connected), the sender check is skipped — documented fallback
 * for the manual skill path. Case-insensitive; tolerates "Name <addr>" forms.
 */
export function matchEmailMessage(
  message: Pick<IncomingEmailMessage, "from" | "to" | "cc">,
  contactsByEmail: Map<string, { partnershipId: string }>,
  teamDomain?: string | null,
): EmailMatch | null {
  const from = normAddress(message.from);
  const fromContact = contactsByEmail.get(from);
  if (fromContact) {
    return { partnershipId: fromContact.partnershipId, direction: "inbound" };
  }

  if (teamDomain && from.split("@")[1] !== teamDomain.toLowerCase()) return null;

  for (const addr of [...message.to, ...message.cc]) {
    const contact = contactsByEmail.get(normAddress(addr));
    if (contact) {
      return { partnershipId: contact.partnershipId, direction: "outbound" };
    }
  }
  return null;
}

export interface IngestEmailsResult {
  inserted: number;
  skipped: number;
  unmatched: { externalId: string; reason: string }[];
  stageChanges: { partnershipId: string; from: string; to: string }[];
}

export interface IngestEmailsOptions {
  /** Pass the roster the caller already loaded to save a full scan. */
  roster?: EmailRosterContact[];
  /** Domain of the connected mailbox; gates "outbound" classification. */
  teamDomain?: string | null;
}

export async function ingestEmails(
  messages: IncomingEmailMessage[],
  opts: IngestEmailsOptions = {},
): Promise<IngestEmailsResult> {
  const result: IngestEmailsResult = { inserted: 0, skipped: 0, unmatched: [], stageChanges: [] };
  if (messages.length === 0) return result;

  const roster = opts.roster ?? (await getEmailRoster());
  // Roster is ordered most-recently-updated first; first wins so an address
  // shared by two creators files against the live partnership, not the stale one.
  const contactsByEmail = new Map<string, { partnershipId: string }>();
  for (const c of roster) {
    const key = c.businessEmail.toLowerCase();
    if (!contactsByEmail.has(key)) contactsByEmail.set(key, { partnershipId: c.partnershipId });
  }

  // Prior-outbound lookup decides initial vs follow_up per partnership.
  const partnershipIds = [...new Set(roster.map((c) => c.partnershipId))];
  const priorOutbound = partnershipIds.length
    ? await db
        .select({ partnershipId: cmOutreachEvents.partnershipId })
        .from(cmOutreachEvents)
        .where(
          and(
            inArray(cmOutreachEvents.partnershipId, partnershipIds),
            eq(cmOutreachEvents.direction, "outbound"),
          ),
        )
    : [];
  const hasOutbound = new Set(priorOutbound.map((r) => r.partnershipId));

  // Oldest first so initial/follow_up ordering and stage advances are natural.
  const ordered = [...messages].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );

  for (const msg of ordered) {
    const match = matchEmailMessage(msg, contactsByEmail, opts.teamDomain);
    if (!match) {
      result.unmatched.push({ externalId: msg.externalId, reason: "no roster address on the message, or sender is not the team" });
      continue;
    }

    const kind =
      match.direction === "inbound"
        ? ("reply" as const)
        : hasOutbound.has(match.partnershipId)
          ? ("follow_up" as const)
          : ("initial" as const);

    // A re-synced message refreshes only how it is displayed (cleaned body,
    // from/to) — never its direction, kind, or the pipeline stage.
    const [row] = await db
      .insert(cmOutreachEvents)
      .values({
        partnershipId: match.partnershipId,
        occurredAt: new Date(msg.occurredAt),
        direction: match.direction,
        channel: "email",
        kind,
        body: cleanEmailBody(msg.bodyText),
        subject: msg.subject,
        fromAddress: msg.from,
        toAddress: msg.to.join(", ") || null,
        externalId: msg.externalId,
        threadId: msg.threadId,
      })
      .onConflictDoUpdate({
        target: cmOutreachEvents.externalId,
        set: {
          body: sql`excluded.body`,
          fromAddress: sql`excluded.from_address`,
          toAddress: sql`excluded.to_address`,
        },
      })
      .returning({ id: cmOutreachEvents.id, isNew: sql<boolean>`(xmax = 0)` });

    if (!row?.isNew) {
      result.skipped++; // already synced — the unique externalId absorbed it
      continue;
    }
    result.inserted++;
    if (match.direction === "outbound") hasOutbound.add(match.partnershipId);

    const changed = await applyAutoStage(
      match.partnershipId,
      match.direction === "inbound" ? "inbound_message" : "outbound_message",
    );
    if (changed) {
      result.stageChanges.push({ partnershipId: match.partnershipId, from: changed.from, to: changed.to });
    }
  }

  return result;
}
