import { and, desc, eq, inArray, isNotNull, isNull, max, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cmClientUsers,
  cmContracts,
  cmCreators,
  cmCreatorEmails,
  cmPartnerships,
  cmOutreachEvents,
  cmStageTransitions,
  users,
  type CmStage,
} from "@/lib/db/schema";
import { MAX_CONTRACT_BYTES, looksLikeContract, safeFilename } from "@/lib/contracts";
import { applyAutoStage } from "@/lib/auto-stage";
import { cleanEmailBody } from "@/lib/email-body";
import { isTerminal } from "@/lib/stages";
import { emailDomain, parseEmailAddress } from "@/lib/gmail";

/**
 * Turning mailbox messages into creator conversations. All the rules live
 * here as pure functions (unit-tested in verify-email-ingest.ts); the Gmail
 * plumbing is in gmail-sync.ts.
 *
 * Only creators someone entered into the app are tracked: the roster is
 * every creator with an email address, and a message that involves none of
 * those addresses is never stored.
 */

/* ── Roster ─────────────────────────────────────────────────────── */

export interface RosterPartnership {
  id: string;
  stage: CmStage;
  updatedAt: Date;
}

export interface RosterCreator {
  creatorId: string;
  name: string;
  /** Lowercased: businessEmail plus every cm_creator_emails address. */
  addresses: string[];
  /** Every partnership — closed ones too, so a late reply is still stored. */
  partnerships: RosterPartnership[];
}

export function normAddress(addr: string): string {
  return parseEmailAddress(addr)?.email ?? addr.trim().toLowerCase();
}

const ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function getEmailRoster(): Promise<RosterCreator[]> {
  const creators = await db
    .select({ id: cmCreators.id, name: cmCreators.name, businessEmail: cmCreators.businessEmail })
    .from(cmCreators);
  const extra = await db.select({ creatorId: cmCreatorEmails.creatorId, email: cmCreatorEmails.email }).from(cmCreatorEmails);
  const addressesBy = new Map<string, Set<string>>();
  const add = (creatorId: string, raw: string | null) => {
    const a = raw?.trim().toLowerCase();
    if (!a || !ADDRESS_RE.test(a)) return;
    const set = addressesBy.get(creatorId) ?? new Set<string>();
    set.add(a);
    addressesBy.set(creatorId, set);
  };
  for (const c of creators) add(c.id, c.businessEmail);
  for (const e of extra) add(e.creatorId, e.email);
  if (addressesBy.size === 0) return [];

  const partnerships = await db
    .select({ id: cmPartnerships.id, creatorId: cmPartnerships.creatorId, stage: cmPartnerships.stage, updatedAt: cmPartnerships.updatedAt })
    .from(cmPartnerships)
    .where(inArray(cmPartnerships.creatorId, [...addressesBy.keys()]))
    .orderBy(desc(cmPartnerships.updatedAt));
  const byCreator = new Map<string, RosterPartnership[]>();
  for (const p of partnerships) {
    const list = byCreator.get(p.creatorId) ?? [];
    list.push({ id: p.id, stage: p.stage, updatedAt: p.updatedAt });
    byCreator.set(p.creatorId, list);
  }

  const out: RosterCreator[] = [];
  for (const c of creators) {
    const addresses = addressesBy.get(c.id);
    const ps = byCreator.get(c.id);
    if (!addresses || !ps?.length) continue; // a creator with no campaign has nowhere to file mail
    out.push({ creatorId: c.id, name: c.name, addresses: [...addresses], partnerships: ps });
  }
  return out;
}

/* ── Who is "us" ────────────────────────────────────────────────── */

/** Mailbox domains shared by the whole world — never evidence that a sender is on the team. */
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com",
  "yandex.com", "comcast.net", "att.net", "verizon.net",
]);

export interface TeamIdentity {
  mailbox: string;
  /** The mailbox, every teammate login, and every "Our side" address. */
  emails: Set<string>;
  /** The mailbox's domain (unless free-mail) plus every "Our side" @domain. */
  domains: Set<string>;
  /** People at a client (Settings → client team): address → their client. */
  clientContacts?: Map<string, string>;
  /** Each creator's client, so a client contact counts only on their own brand's creators. */
  creatorClients?: Map<string, string>;
}

/**
 * `extra` is the "Our side" list from Settings: addresses, or "@domain.com"
 * for everyone at a domain (client staff, a partner agency). A free-mail
 * domain is never accepted as a whole domain.
 */
export function teamIdentity(mailbox: string, userEmails: string[] = [], extra: string[] = []): TeamIdentity {
  const m = mailbox.trim().toLowerCase();
  const emails = new Set([m, ...userEmails.map((e) => e.trim().toLowerCase())]);
  const domains = new Set<string>();
  const own = emailDomain(m);
  if (own && !FREE_MAIL_DOMAINS.has(own)) domains.add(own);
  for (const raw of extra) {
    const e = raw.trim().toLowerCase();
    if (!e) continue;
    if (e.startsWith("@")) {
      const d = e.slice(1);
      if (d && !FREE_MAIL_DOMAINS.has(d)) domains.add(d);
    } else if (e.includes("@")) emails.add(e);
  }
  return { mailbox: m, emails, domains };
}

export async function loadTeamIdentity(mailbox: string, extra: string[] = []): Promise<TeamIdentity> {
  const [rows, contacts, creators] = await Promise.all([
    db.select({ email: users.email }).from(users),
    db.select({ email: cmClientUsers.email, clientId: cmClientUsers.clientId }).from(cmClientUsers),
    db.select({ id: cmCreators.id, clientId: cmCreators.clientId }).from(cmCreators),
  ]);
  return {
    ...teamIdentity(mailbox, rows.map((r) => r.email), extra),
    clientContacts: new Map(contacts.map((c) => [c.email.trim().toLowerCase(), c.clientId])),
    creatorClients: new Map(creators.map((c) => [c.id, c.clientId])),
  };
}

/* ── Classifying one message ────────────────────────────────────── */

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
  labelIds?: string[];
  messageId?: string | null;
  autoSubmitted?: string | null;
  autoReplyHeader?: boolean;
  precedence?: string | null;
  hasCalendar?: boolean;
  /** PDF attachments (partId + name) — recorded as possible contracts. */
  pdfs?: { partId: string; filename: string; size?: number }[];
}

/** "client" = someone at the creator's own brand (their client team), kept as a note. */
export type SenderRole = "team" | "creator" | "client" | "other";

export interface Classification {
  creatorId: string;
  direction: "inbound" | "outbound";
  /** "other" = someone else on a creator's thread (a manager, a parent). */
  senderRole: SenderRole;
  /**
   * Calendar invites, auto-replies and no-reply mail never change whose turn
   * it is — nor does the client writing (it's neither the creator nor us).
   */
  note: null | "calendar" | "auto_reply" | "automated" | "client";
}

const CALENDAR_SUBJECT = /^(invitation|updated invitation|accepted|declined|tentatively accepted|cancell?ed( event)?|invitation from google calendar)\b.*[:@]/i;
const AUTO_REPLY_SUBJECT = /^(automatic reply|auto(matic)?[- ]?(reply|response)|out of (the )?office|away from (the )?office)\b/i;
const NO_REPLY_SENDER = /^(no-?reply|do-?not-?reply|notifications?|notify|calendar-notification|mailer-daemon|postmaster|bounces?)@/i;

/** Pure: is this a message nobody wrote to the other side (invite, auto-reply, robot)? */
export function noteReason(msg: IncomingEmailMessage): Classification["note"] {
  const subject = (msg.subject ?? "").trim();
  if (msg.hasCalendar || CALENDAR_SUBJECT.test(subject)) return "calendar";
  const autoSubmitted = (msg.autoSubmitted ?? "").trim().toLowerCase();
  if ((autoSubmitted && autoSubmitted !== "no") || msg.autoReplyHeader || AUTO_REPLY_SUBJECT.test(subject)) return "auto_reply";
  const precedence = (msg.precedence ?? "").trim().toLowerCase();
  if (["auto_reply", "bulk", "list", "junk"].includes(precedence)) return "automated";
  if (NO_REPLY_SENDER.test(normAddress(msg.from))) return "automated";
  return null;
}

/** Pure: is the sender on our side? */
export function isTeamSender(from: string, labelIds: string[] | undefined, team: TeamIdentity): boolean {
  if (labelIds?.includes("SENT")) return true;
  const a = normAddress(from);
  if (team.emails.has(a)) return true;
  return team.domains.has(emailDomain(a));
}

/**
 * Pure: whose conversation is this, and which way did it go?
 *  - from a creator's address            → inbound from the creator
 *  - from the team to a creator          → outbound
 *  - from anyone else, creator on To/Cc  → inbound from another participant
 *    (never "our follow-up": a manager cc'ing the creator is not us writing)
 *  - no creator address on it at all     → null (not stored)
 */
export function classifyMessage(
  msg: IncomingEmailMessage,
  creatorsByAddress: Map<string, string[]>,
  team: TeamIdentity,
): Classification | null {
  const from = normAddress(msg.from);
  const note = noteReason(msg);
  // Someone listed on a client's team outranks an Our-side *domain* (the list
  // is explicit, the domain a blanket rule) — never our own mailbox's SENT
  // mail or an address listed on Our side by name.
  const contactOf = team.clientContacts?.get(from);
  const explicitlyOurs = !!msg.labelIds?.includes("SENT") || team.emails.has(from);
  const team_ = contactOf ? explicitlyOurs : isTeamSender(msg.from, msg.labelIds, team);
  const fromCreator = team_ ? undefined : creatorsByAddress.get(from)?.[0];
  if (fromCreator) return { creatorId: fromCreator, direction: "inbound", senderRole: "creator", note };

  let recipient: string | undefined;
  for (const addr of [...msg.to, ...msg.cc]) {
    recipient = creatorsByAddress.get(normAddress(addr))?.[0];
    if (recipient) break;
  }
  if (!recipient) return null;
  if (team_) return { creatorId: recipient, direction: "outbound", senderRole: "team", note };
  // Someone at the creator's own brand: shown as the client's, and kept as a note so it
  // never counts as the creator replying or as us answering.
  if (contactOf && contactOf === team.creatorClients?.get(recipient)) {
    return { creatorId: recipient, direction: "inbound", senderRole: "client", note: note ?? "client" };
  }
  return { creatorId: recipient, direction: "inbound", senderRole: "other", note };
}

/**
 * Pure: which of a creator's partnerships this message belongs to. The one
 * already holding the thread wins while it's still open; else the open
 * partnership that moved most recently; else the most recent one.
 */
export function choosePartnership(
  creator: Pick<RosterCreator, "partnerships">,
  threadOwner: string | null,
): string | null {
  const open = (p: RosterPartnership) => !isTerminal(p.stage) && p.stage !== "posted";
  if (threadOwner) {
    const owner = creator.partnerships.find((p) => p.id === threadOwner);
    if (owner && open(owner)) return owner.id;
  }
  const sorted = [...creator.partnerships].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return (sorted.find(open) ?? sorted[0])?.id ?? null;
}

type Kind = "initial" | "follow_up" | "reply" | "note";

/**
 * Pure: the kind of every message in one conversation, oldest first.
 *   inbound                      → reply
 *   outbound, nothing before it  → initial
 *   outbound after an inbound    → reply     (we answered them)
 *   outbound after an outbound   → follow_up (we chased them)
 * Notes (invites, auto-replies, hand-written notes) keep "note" and are
 * invisible to the sequence.
 */
export function computeKinds(
  events: { id: string; direction: "inbound" | "outbound"; kind: Kind; occurredAt: Date; createdAt?: Date }[],
): Map<string, Kind> {
  const ordered = [...events].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
  );
  const out = new Map<string, Kind>();
  let prev: "inbound" | "outbound" | null = null;
  for (const e of ordered) {
    if (e.kind === "note") {
      out.set(e.id, "note");
      continue;
    }
    if (e.direction === "inbound") out.set(e.id, "reply");
    else out.set(e.id, prev === null ? "initial" : prev === "inbound" ? "reply" : "follow_up");
    prev = e.direction;
  }
  return out;
}

/* ── Ingest ─────────────────────────────────────────────────────── */

export interface IngestEmailsResult {
  inserted: number;
  skipped: number;
  /** Messages that involved no roster address (counted, never stored). */
  unmatched: number;
  stageChanges: { partnershipId: string; from: string; to: string }[];
  /** Partnerships that received new mail — the ones worth re-reading. */
  touched: string[];
  /** PDF attachments recorded as possible contracts. */
  contracts?: number;
}

export interface IngestEmailsOptions {
  roster?: RosterCreator[];
  team: TeamIdentity;
}

export async function ingestEmails(messages: IncomingEmailMessage[], opts: IngestEmailsOptions): Promise<IngestEmailsResult> {
  const result: IngestEmailsResult = { inserted: 0, skipped: 0, unmatched: 0, stageChanges: [], touched: [] };
  if (messages.length === 0) return result;

  const roster = opts.roster ?? (await getEmailRoster());
  const creatorsByAddress = new Map<string, string[]>();
  const creatorById = new Map<string, RosterCreator>();
  for (const c of roster) {
    creatorById.set(c.creatorId, c);
    for (const a of c.addresses) creatorsByAddress.set(a, [...(creatorsByAddress.get(a) ?? []), c.creatorId]);
  }

  const threadIds = [...new Set(messages.map((m) => m.threadId).filter((t): t is string => !!t))];
  const owners = threadIds.length
    ? await db
        .select({ threadId: cmOutreachEvents.threadId, partnershipId: cmOutreachEvents.partnershipId })
        .from(cmOutreachEvents)
        .where(inArray(cmOutreachEvents.threadId, threadIds))
        .orderBy(desc(cmOutreachEvents.occurredAt))
    : [];
  const threadOwner = new Map<string, string>();
  for (const o of owners) if (o.threadId && !threadOwner.has(o.threadId)) threadOwner.set(o.threadId, o.partnershipId);

  const ordered = [...messages].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  const fresh = new Map<string, { id: string; direction: "inbound" | "outbound"; senderRole: SenderRole; occurredAt: Date; note: boolean }[]>();

  for (const msg of ordered) {
    // Never stored: drafts (not sent) and Spam (a spoofed "creator" address lands there).
    if (msg.labelIds?.includes("DRAFT") || msg.labelIds?.includes("SPAM")) {
      result.unmatched++;
      continue;
    }
    const c = classifyMessage(msg, creatorsByAddress, opts.team);
    const creator = c ? creatorById.get(c.creatorId) : undefined;
    const partnershipId = creator ? choosePartnership(creator, msg.threadId ? threadOwner.get(msg.threadId) ?? null : null) : null;
    if (!c || !partnershipId) {
      result.unmatched++;
      continue;
    }
    let row: { id: string } | undefined;
    try {
      [row] = await db
        .insert(cmOutreachEvents)
        .values({
          partnershipId,
          occurredAt: new Date(msg.occurredAt),
          direction: c.direction,
          channel: "email",
          // Provisional for outbound; the whole conversation is re-sequenced below.
          kind: c.note ? "note" : c.direction === "inbound" ? "reply" : "follow_up",
          body: cleanEmailBody(msg.bodyText),
          subject: msg.subject,
          fromAddress: msg.from,
          toAddress: msg.to.join(", ") || null,
          ccAddress: msg.cc.join(", ") || null,
          messageId: msg.messageId ?? null,
          senderRole: c.senderRole,
          externalId: msg.externalId,
          threadId: msg.threadId,
        })
        .onConflictDoNothing({ target: cmOutreachEvents.externalId })
        .returning({ id: cmOutreachEvents.id });
    } catch {
      // The partnership was deleted mid-check: skip this message, keep the run.
      result.skipped++;
      continue;
    }
    if (!row) {
      result.skipped++; // already stored — the unique message id absorbed it
      continue;
    }
    result.inserted++;
    // PDFs from the creator, us or the brand may be the contract: recorded now,
    // downloaded and read after the check. Never a stranger's on the thread.
    // Ours only when it looks like a contract — not every brief or deck we send.
    const pdfs = (msg.pdfs ?? []).filter((a) => (!a.size || a.size <= MAX_CONTRACT_BYTES) && (c.senderRole !== "team" || looksLikeContract(a.filename, msg.subject)));
    if (pdfs.length && c.senderRole !== "other") {
      // A failure here never costs the check the message itself.
      await db
        .insert(cmContracts)
        .values(
          pdfs.map((a) => ({
            partnershipId,
            source: "email" as const,
            filename: safeFilename(a.filename),
            sizeBytes: a.size || null,
            outreachEventId: row!.id,
            gmailMessageId: msg.externalId,
            gmailPartId: a.partId,
            receivedAt: new Date(msg.occurredAt),
          })),
        )
        .onConflictDoNothing()
        .then(() => (result.contracts = (result.contracts ?? 0) + pdfs.length))
        .catch(() => undefined);
    }
    if (msg.threadId && !threadOwner.has(msg.threadId)) threadOwner.set(msg.threadId, partnershipId);
    const list = fresh.get(partnershipId) ?? [];
    list.push({ id: row.id, direction: c.direction, senderRole: c.senderRole, occurredAt: new Date(msg.occurredAt), note: !!c.note });
    fresh.set(partnershipId, list);
  }

  result.touched = [...fresh.keys()];
  await recomputeEmailKinds(result.touched);

  // Rule moves from email only count messages newer than the last time a
  // person set the stage — a backfilled old reply must not undo a decision
  // (or reopen a deal someone closed after it).
  const since = await lastManualChangeAt(result.touched);
  for (const [partnershipId, events] of fresh) {
    const cutoff = since.get(partnershipId);
    const live = events.filter((e) => !e.note && (!cutoff || e.occurredAt > cutoff));
    const lastOut = live.filter((e) => e.senderRole === "team").at(-1);
    // Only the creator's own message is "they replied": someone else on the
    // thread may be on their side or ours, so it never moves a stage by rule.
    const lastIn = live.filter((e) => e.senderRole === "creator").at(-1);
    for (const [trigger, evidence] of [
      ["outbound_message", lastOut],
      ["inbound_message", lastIn],
    ] as const) {
      if (!evidence) continue;
      const changed = await applyAutoStage(partnershipId, trigger, undefined, { evidenceEventId: evidence.id });
      if (changed) result.stageChanges.push({ partnershipId, from: changed.from, to: changed.to });
    }
  }
  return result;
}

/** Re-sequence initial / reply / follow_up for the email messages of these partnerships. */
export async function recomputeEmailKinds(partnershipIds: string[]): Promise<number> {
  if (partnershipIds.length === 0) return 0;
  const events = await db
    .select({
      id: cmOutreachEvents.id,
      partnershipId: cmOutreachEvents.partnershipId,
      direction: cmOutreachEvents.direction,
      kind: cmOutreachEvents.kind,
      channel: cmOutreachEvents.channel,
      occurredAt: cmOutreachEvents.occurredAt,
      createdAt: cmOutreachEvents.createdAt,
    })
    .from(cmOutreachEvents)
    .where(inArray(cmOutreachEvents.partnershipId, partnershipIds));
  let changed = 0;
  for (const pid of partnershipIds) {
    const mine = events.filter((e) => e.partnershipId === pid);
    const kinds = computeKinds(mine);
    for (const e of mine) {
      // Only synced email is re-labelled; hand-logged entries keep what the person chose.
      const next = kinds.get(e.id);
      if (e.channel === "email" && next && next !== e.kind) {
        await db.update(cmOutreachEvents).set({ kind: next }).where(eq(cmOutreachEvents.id, e.id));
        changed++;
      }
    }
  }
  return changed;
}

/**
 * The last time a person (or the one-time migration) set each partnership's
 * stage. Transitions written before the `source` column existed count as a
 * person's — the conservative reading. The opening row (a creator being
 * added, from_stage null) is not a decision about their mail, so it never
 * blocks what the mailbox shows.
 */
export async function lastManualChangeAt(partnershipIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (partnershipIds.length === 0) return out;
  const rows = await db
    // max() on the column keeps its UTC mapping — a raw "max(...)" string
    // parsed with new Date() would be read as local time (7h off in Pacific).
    .select({ partnershipId: cmStageTransitions.partnershipId, at: max(cmStageTransitions.changedAt) })
    .from(cmStageTransitions)
    .where(
      and(
        inArray(cmStageTransitions.partnershipId, partnershipIds),
        isNotNull(cmStageTransitions.fromStage),
        or(isNull(cmStageTransitions.source), inArray(cmStageTransitions.source, ["manual", "migration"])),
        isNull(cmStageTransitions.undoneAt),
      ),
    )
    .groupBy(cmStageTransitions.partnershipId);
  for (const r of rows) if (r.at) out.set(r.partnershipId, r.at);
  return out;
}

/** Every stored Gmail message id, for skipping what's already been fetched. */
export async function storedMessageIds(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await db
      .select({ externalId: cmOutreachEvents.externalId })
      .from(cmOutreachEvents)
      .where(and(isNotNull(cmOutreachEvents.externalId), inArray(cmOutreachEvents.externalId, chunk)));
    for (const r of rows) if (r.externalId) out.add(r.externalId);
  }
  return out;
}

/**
 * Re-decide who wrote each stored email from its saved headers — after the
 * "Our side" list changes — without downloading anything. Invite and
 * auto-reply notes stay notes; kinds are re-sequenced. Never moves a message
 * to another partnership and never moves a stage.
 */
export async function reclassifyStoredEmails(team: TeamIdentity): Promise<{ changed: number }> {
  const roster = await getEmailRoster();
  const creatorsByAddress = new Map<string, string[]>();
  for (const c of roster) for (const a of c.addresses) creatorsByAddress.set(a, [...(creatorsByAddress.get(a) ?? []), c.creatorId]);
  const rows = await db
    .select({
      id: cmOutreachEvents.id,
      partnershipId: cmOutreachEvents.partnershipId,
      direction: cmOutreachEvents.direction,
      senderRole: cmOutreachEvents.senderRole,
      from: cmOutreachEvents.fromAddress,
      to: cmOutreachEvents.toAddress,
      cc: cmOutreachEvents.ccAddress,
      subject: cmOutreachEvents.subject,
      kind: cmOutreachEvents.kind,
    })
    .from(cmOutreachEvents)
    .where(and(eq(cmOutreachEvents.channel, "email"), isNotNull(cmOutreachEvents.fromAddress)));
  let changed = 0;
  const touched = new Set<string>();
  for (const r of rows) {
    const c = classifyMessage(
      {
        externalId: r.id,
        threadId: null,
        occurredAt: new Date().toISOString(),
        from: r.from ?? "",
        to: (r.to ?? "").split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((s) => s.trim()).filter(Boolean),
        cc: (r.cc ?? "").split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((s) => s.trim()).filter(Boolean),
        subject: r.subject,
        bodyText: null,
      },
      creatorsByAddress,
      team,
    );
    if (!c || (c.direction === r.direction && c.senderRole === r.senderRole)) continue;
    // Mail we sent was recognised by its SENT label, which isn't stored — the
    // headers alone can't overrule it, so ours stays ours. The one exception:
    // a sender now listed on the creator's client team (explicit) was only
    // "ours" by an Our-side domain rule, and becomes the client's.
    if (r.senderRole === "team" && c.senderRole !== "team" && c.senderRole !== "client") continue;
    // Becoming the client's makes it a note; no longer the client's, it's a message
    // again — unless it's an invite or auto-reply by its subject or sender.
    const kind =
      c.senderRole === "client" ? "note" : r.senderRole === "client" ? (c.note ? "note" : c.direction === "inbound" ? "reply" : "follow_up") : undefined;
    await db.update(cmOutreachEvents).set({ direction: c.direction, senderRole: c.senderRole, ...(kind ? { kind } : {}) }).where(eq(cmOutreachEvents.id, r.id));
    touched.add(r.partnershipId);
    changed++;
  }
  await recomputeEmailKinds([...touched]);
  return { changed };
}
