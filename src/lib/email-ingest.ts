import { and, desc, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  clients,
  cmCreators,
  cmPartnerships,
  cmOutreachEvents,
} from "@/lib/db/schema";
import { applyAutoStage } from "@/lib/auto-stage";

/**
 * Server side of the Gmail sync (Track B). The sync skill sends raw Gmail
 * facts; ALL matching logic lives here so the skill stays dumb and the rules
 * are unit-testable.
 *
 * Coverage caveat (documented in the skill + README): only threads where the
 * cc'd mailbox appears can be synced — a creator reply that doesn't
 * reply-all is invisible to this pipeline.
 */

const TERMINAL_STAGES = ["passed", "declined", "no_response"] as const;

export interface EmailRosterContact {
  partnershipId: string;
  creatorId: string;
  clientSlug: string;
  name: string;
  username: string;
  businessEmail: string;
  stage: string;
}

/** Creators with a business email and at least one open (non-terminal) partnership. */
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
    .where(
      and(
        isNotNull(cmCreators.businessEmail),
        notInArray(cmPartnerships.stage, [...TERMINAL_STAGES]),
      ),
    )
    .orderBy(desc(cmPartnerships.updatedAt));

  // One contact per creator — the most recently updated open partnership wins.
  const seen = new Set<string>();
  const contacts: EmailRosterContact[] = [];
  for (const r of rows) {
    if (seen.has(r.creatorId)) continue;
    seen.add(r.creatorId);
    contacts.push({
      partnershipId: r.partnershipId,
      creatorId: r.creatorId,
      clientSlug: r.clientSlug,
      name: r.name,
      username: r.username,
      businessEmail: r.businessEmail as string,
      stage: r.stage,
    });
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

/**
 * Pure matcher. A message FROM the creator's businessEmail is inbound; a
 * message TO/cc the creator is outbound (sent by the team). Case-insensitive;
 * tolerates "Display Name <addr>" forms.
 */
export function matchEmailMessage(
  message: Pick<IncomingEmailMessage, "from" | "to" | "cc">,
  contactsByEmail: Map<string, { partnershipId: string }>,
): EmailMatch | null {
  const norm = (addr: string) => {
    const m = addr.match(/<([^>]+)>/);
    return (m ? m[1] : addr).trim().toLowerCase();
  };

  const from = norm(message.from);
  const fromContact = contactsByEmail.get(from);
  if (fromContact) {
    return { partnershipId: fromContact.partnershipId, direction: "inbound" };
  }

  for (const addr of [...message.to, ...message.cc]) {
    const contact = contactsByEmail.get(norm(addr));
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

export async function ingestEmails(messages: IncomingEmailMessage[]): Promise<IngestEmailsResult> {
  const result: IngestEmailsResult = { inserted: 0, skipped: 0, unmatched: [], stageChanges: [] };
  if (messages.length === 0) return result;

  const roster = await getEmailRoster();
  const contactsByEmail = new Map(
    roster.map((c) => [c.businessEmail.toLowerCase(), { partnershipId: c.partnershipId }]),
  );

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
    const match = matchEmailMessage(msg, contactsByEmail);
    if (!match) {
      result.unmatched.push({ externalId: msg.externalId, reason: "no roster address on the message" });
      continue;
    }

    const kind =
      match.direction === "inbound"
        ? ("reply" as const)
        : hasOutbound.has(match.partnershipId)
          ? ("follow_up" as const)
          : ("initial" as const);

    const inserted = await db
      .insert(cmOutreachEvents)
      .values({
        partnershipId: match.partnershipId,
        occurredAt: new Date(msg.occurredAt),
        direction: match.direction,
        channel: "email",
        kind,
        body: msg.bodyText,
        subject: msg.subject,
        externalId: msg.externalId,
        threadId: msg.threadId,
      })
      .onConflictDoNothing({ target: cmOutreachEvents.externalId })
      .returning({ id: cmOutreachEvents.id });

    if (inserted.length === 0) {
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
