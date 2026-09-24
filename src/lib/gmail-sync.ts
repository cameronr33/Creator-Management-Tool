import { after } from "next/server";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmContracts, cmGmailAccounts, cmOutreachEvents, type CmGmailAccount } from "@/lib/db/schema";
import { decrypt } from "@/lib/encryption";
import { describeSyncOutcome, requireCompleteSync } from "@/lib/gmail-sync-outcome";
import {
  refreshAccessToken,
  buildSearchQueries,
  listMessageIds,
  getMessage,
  getAttachment,
  header,
  normalizeMessage,
  pdfAttachments,
  type NormalizedGmailMessage,
  type SearchWindow,
} from "@/lib/gmail";
import {
  classifyMessage,
  getEmailRoster,
  ingestEmails,
  loadTeamIdentity,
  normAddress,
  recomputeEmailKinds,
  storedMessageIds,
  type IngestEmailsResult,
} from "@/lib/email-ingest";
import { cleanEmailBody } from "@/lib/email-body";
import { runJob } from "@/lib/job-runs";
import { readPendingConversations } from "@/lib/email-status";
import { MAX_CONTRACT_BYTES, attachDownloaded, contractsToDownload, looksLikeContract, noteDownloadFailed, readPendingContracts, safeFilename } from "@/lib/contracts";

/**
 * The email check: connected Gmail account → search for the addresses of
 * creators entered in the app → store what's new → move stages the rules
 * allow.
 *
 * It only ever searches for those addresses. Nothing else in the mailbox is
 * read or stored — it's a broad work inbox.
 *
 * Coverage model:
 *  - An address seen for the first time gets a 180-day search.
 *  - Every other address only needs mail since `syncedThrough` (less an hour
 *    of overlap), which only advances when a check completes — a partial or
 *    failed check re-covers the gap next time. Gmail message ids make the
 *    overlap harmless.
 *  - Messages already stored are never downloaded again.
 * One lease on the account row serialises every trigger (schedule, page
 * visit, button, a newly added address).
 */

export const BACKFILL_DAYS = 180;
const OVERLAP_MS = 60 * 60 * 1000;
const LEASE_MS = 10 * 60 * 1000;
const FETCH_CAP = 1500;
const CONCURRENCY = 8;
/** A page visit triggers a check when the last one is older than this. */
export const FRESH_FOR_MS = 15 * 60 * 1000;

export type SyncTrigger = "cron" | "visit" | "button" | "address" | "resync";

export async function getActiveGmailAccount(): Promise<CmGmailAccount | null> {
  const [account] = await db.select().from(cmGmailAccounts).where(eq(cmGmailAccounts.isActive, true)).limit(1);
  return account ?? null;
}

export interface SyncRunResult extends IngestEmailsResult {
  account: string;
  trigger: SyncTrigger;
  /** Addresses searched (known + first-time). */
  rosterSize: number;
  /** First-time addresses that got the 180-day search. */
  backfilled: number;
  messagesFetched: number;
  /** Searches or message downloads that failed (the run is partial). */
  fetchErrors: number;
  /** A search or the download cap was hit (the run is partial). */
  truncated: boolean;
}

/** Run `fn` over `items` with at most `limit` in flight; failures are counted, not thrown. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<{ ok: R[]; failed: number }> {
  const ok: R[] = [];
  let failed = 0;
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        ok.push(await fn(item));
      } catch {
        failed++;
      }
    }
  });
  await Promise.all(workers);
  return { ok, failed };
}

/** Pure: which searches a check runs. */
export function planSearches(opts: {
  addresses: string[];
  backfilled: string[];
  syncedThrough: Date | null;
  windowDays?: number;
}): { queries: string[]; fresh: string[] } {
  const all = [...new Set(opts.addresses)];
  if (opts.windowDays) return { queries: buildSearchQueries(all, { newerThanDays: opts.windowDays }), fresh: all };
  const done = new Set(opts.backfilled);
  // Without a completed check on record nothing counts as covered.
  const known = opts.syncedThrough ? all.filter((a) => done.has(a)) : [];
  const fresh = all.filter((a) => !known.includes(a));
  const since: SearchWindow | null = opts.syncedThrough
    ? { afterEpochSeconds: (opts.syncedThrough.getTime() - OVERLAP_MS) / 1000 }
    : null;
  return {
    queries: [
      ...buildSearchQueries(fresh, { newerThanDays: BACKFILL_DAYS }),
      ...(since ? buildSearchQueries(known, since) : []),
    ],
    fresh,
  };
}

/**
 * Pure: what a finished check may record as covered. Only a complete check
 * advances anything. A resync over a short window doesn't cover a new
 * address's 180 days, and only moves the cursor when its window reaches back
 * past the old one — otherwise the gap between them would count as searched.
 */
export function coverageAfter(opts: {
  complete: boolean;
  startedAt: Date;
  windowDays?: number;
  syncedThrough: Date | null;
  backfilled: string[];
  addresses: string[];
  fresh: string[];
}): { syncedThrough: Date | null; backfilledAddresses: string[] } | null {
  if (!opts.complete) return null;
  const kept = opts.backfilled.filter((a) => opts.addresses.includes(a));
  const full = !opts.windowDays || opts.windowDays >= BACKFILL_DAYS;
  if (full) return { syncedThrough: opts.startedAt, backfilledAddresses: [...new Set([...kept, ...opts.fresh])] };
  const windowStart = opts.startedAt.getTime() - opts.windowDays! * 86_400_000;
  const reachesBack = !!opts.syncedThrough && windowStart <= opts.syncedThrough.getTime();
  return { syncedThrough: reachesBack ? opts.startedAt : opts.syncedThrough, backfilledAddresses: kept };
}

/** Take the lease; returns its expiry (our token) or null when another check holds it. */
async function acquireLease(accountId: string): Promise<Date | null> {
  const until = new Date(Date.now() + LEASE_MS);
  const got = await db
    .update(cmGmailAccounts)
    .set({ syncLeaseUntil: until })
    .where(and(eq(cmGmailAccounts.id, accountId), or(isNull(cmGmailAccounts.syncLeaseUntil), lt(cmGmailAccounts.syncLeaseUntil, new Date()))))
    .returning({ id: cmGmailAccounts.id });
  return got.length > 0 ? until : null;
}

/** Release only our own lease: a check that overran it mustn't free a newer check's. */
async function releaseLease(accountId: string, mine: Date): Promise<void> {
  await db
    .update(cmGmailAccounts)
    .set({ syncLeaseUntil: null })
    .where(and(eq(cmGmailAccounts.id, accountId), eq(cmGmailAccounts.syncLeaseUntil, mine)));
}

/** Thrown when another check holds the lease — callers treat it as "already running". */
export class SyncBusyError extends Error {
  constructor() {
    super("An email check is already running.");
  }
}

/**
 * Run one check. `windowDays` (the resync script) searches every address
 * over that window instead of the incremental plan.
 */
export async function runGmailSync(opts: { trigger: SyncTrigger; windowDays?: number }): Promise<SyncRunResult> {
  const account = await getActiveGmailAccount();
  if (!account) throw new Error("No Gmail account connected — connect one in Settings.");
  const lease = await acquireLease(account.id);
  if (!lease) throw new SyncBusyError();

  const startedAt = new Date();
  try {
    const accessToken = await refreshAccessToken(decrypt(account.refreshTokenEnc));
    const [roster, team] = await Promise.all([getEmailRoster(), loadTeamIdentity(account.email, account.teamAddresses ?? [])]);
    const addresses = [...new Set(roster.flatMap((c) => c.addresses))];
    const plan = planSearches({
      addresses,
      backfilled: account.backfilledAddresses ?? [],
      syncedThrough: account.syncedThrough,
      windowDays: opts.windowDays,
    });

    const lists = await mapLimit(plan.queries, 4, (q) => listMessageIds(accessToken, q));
    let truncated = lists.ok.some((l) => l.truncated);
    const found = [...new Set(lists.ok.flatMap((l) => l.ids))];
    const stored = await storedMessageIds(found);
    let toFetch = found.filter((id) => !stored.has(id));
    if (toFetch.length > FETCH_CAP) {
      toFetch = toFetch.slice(0, FETCH_CAP);
      truncated = true;
    }
    const fetched = await mapLimit(toFetch, CONCURRENCY, (id) => getMessage(accessToken, id));
    const messages = fetched.ok.map(normalizeMessage).filter((m): m is NormalizedGmailMessage => m !== null);
    const ingest = await ingestEmails(messages, { roster, team });
    // Contract PDFs attached to those messages (or waiting from an earlier check).
    await downloadContracts(accessToken).catch(() => undefined);

    const summary: SyncRunResult = {
      account: account.email,
      trigger: opts.trigger,
      rosterSize: addresses.length,
      backfilled: plan.fresh.length,
      messagesFetched: messages.length,
      fetchErrors: lists.failed + fetched.failed,
      truncated,
      ...ingest,
    };
    const coverage = coverageAfter({
      complete: summary.fetchErrors === 0 && !truncated,
      startedAt,
      windowDays: opts.windowDays,
      syncedThrough: account.syncedThrough,
      backfilled: account.backfilledAddresses ?? [],
      addresses,
      fresh: plan.fresh,
    });
    await db
      .update(cmGmailAccounts)
      .set({
        lastSyncAt: new Date(),
        lastSyncStatus: describeSyncOutcome(summary),
        lastSyncSummary: {
          trigger: summary.trigger,
          inserted: summary.inserted,
          skipped: summary.skipped,
          unmatched: summary.unmatched,
          stageChanges: summary.stageChanges.length,
          messagesFetched: summary.messagesFetched,
          fetchErrors: summary.fetchErrors,
          truncated: summary.truncated,
          rosterSize: summary.rosterSize,
          backfilled: summary.backfilled,
        },
        // Coverage only advances on a complete check. Addresses no longer on
        // any creator drop out, so re-adding one later earns a fresh backfill.
        ...(coverage ?? {}),
      })
      .where(eq(cmGmailAccounts.id, account.id));
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(cmGmailAccounts)
      .set({ lastSyncAt: new Date(), lastSyncStatus: `error: ${message}`, lastSyncSummary: null })
      .where(eq(cmGmailAccounts.id, account.id));
    throw err;
  } finally {
    await releaseLease(account.id, lease);
  }
}

/**
 * One check through the job heartbeat, whatever started it. With
 * `requireComplete` (the scheduled job) a partial check fails the heartbeat
 * — after its successful work is saved — so a dead schedule can't look green.
 */
export async function runEmailCheck(
  trigger: SyncTrigger,
  opts: { requireComplete?: boolean; read?: "inline" | "later" | "none" } = {},
): Promise<SyncRunResult | null> {
  let result: SyncRunResult | null = null;
  let busy = false;
  await runJob("email_sync", async () => {
    const account = await getActiveGmailAccount();
    if (!account) return { status: "idle", summary: { trigger, skipped: "no Gmail account connected" } };
    let r: SyncRunResult;
    try {
      r = await runGmailSync({ trigger });
    } catch (err) {
      // Another check holds the lease: healthy, just not this one's turn.
      if (err instanceof SyncBusyError) {
        busy = true;
        return { status: "idle", summary: { trigger, skipped: "another check was running" } };
      }
      throw err;
    }
    result = r;
    if (opts.requireComplete) requireCompleteSync(r);
    return {
      status: r.rosterSize === 0 ? "idle" : "ok",
      summary: {
        trigger,
        rosterSize: r.rosterSize,
        backfilled: r.backfilled,
        messagesFetched: r.messagesFetched,
        fetchErrors: r.fetchErrors,
        truncated: r.truncated,
        inserted: r.inserted,
        skipped: r.skipped,
        unmatched: r.unmatched,
        stageChanges: r.stageChanges.length,
      },
    };
  });
  if (busy) throw new SyncBusyError();
  // Then read the conversations that got new mail (summary, whose turn, and
  // any stage move the email-reading rules allow). Outside the heartbeat: the
  // job reports the mailbox check; reading has its own error counts.
  // Contracts first: a contract's deal is filled before an email's.
  const read = opts.read ?? "inline";
  const readAll = async () => {
    await readPendingContracts().catch(() => undefined);
    await readPendingConversations();
  };
  if (read === "inline") await readAll();
  else if (read === "later") after(() => readAll().then(() => undefined));
  return result;
}

const DOWNLOADS_PER_CHECK = 10;

/** Pure: Gmail refused because of its rate or quota limits (HTTP 429, or 403 "Quota exceeded" / rateLimitExceeded). */
export function isRateLimited(message: string): boolean {
  return /HTTP 429|Quota exceeded|rateLimitExceeded|userRateLimitExceeded/i.test(message);
}

export interface AttachmentFetchers {
  getMessage: typeof getMessage;
  getAttachment: typeof getAttachment;
}

/**
 * Download contract PDFs recorded from email. Gmail's attachment ids change
 * with every fetch, so the message is fetched again and the part found by its
 * stable part id. A failure is counted on the row and retried next check (up
 * to three times); nothing here throws into the check.
 */
export async function downloadContracts(
  accessToken: string,
  limit = DOWNLOADS_PER_CHECK,
  fetchers: AttachmentFetchers = { getMessage, getAttachment },
  /** Only these rows (tests never touch others). */
  ids?: string[],
): Promise<{ downloaded: number; failed: number }> {
  let downloaded = 0;
  let failed = 0;
  for (const row of await contractsToDownload(limit, ids)) {
    try {
      const msg = await fetchers.getMessage(accessToken, row.gmailMessageId!);
      const part = pdfAttachments(msg.payload).find((a) => a.partId === row.gmailPartId);
      if (!part) throw new Error("the attachment is no longer in that email");
      const r = await attachDownloaded(row.id, await fetchers.getAttachment(accessToken, row.gmailMessageId!, part.attachmentId));
      if (r === "stored") downloaded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Gmail's rate limit isn't this file's fault: stop for now, count nothing, try next check.
      if (isRateLimited(message)) break;
      failed++;
      await noteDownloadFailed(row.id, message).catch(() => undefined);
    }
  }
  return { downloaded, failed };
}

/**
 * One-off: record the PDFs on email already stored (before attachments were
 * looked at), then download a batch. Dry run unless `apply`.
 */
export async function recordStoredAttachments(opts: { apply: boolean; fetchers?: AttachmentFetchers }): Promise<{ messages: number; pdfs: { partnershipId: string; filename: string }[]; errors: number }> {
  const fetchers = opts.fetchers ?? { getMessage, getAttachment };
  const account = await getActiveGmailAccount();
  if (!account) throw new Error("No Gmail account connected");
  const accessToken = await refreshAccessToken(decrypt(account.refreshTokenEnc));
  const stored = await db
    .select({ id: cmOutreachEvents.id, externalId: cmOutreachEvents.externalId, partnershipId: cmOutreachEvents.partnershipId, senderRole: cmOutreachEvents.senderRole, occurredAt: cmOutreachEvents.occurredAt })
    .from(cmOutreachEvents)
    .where(and(isNotNull(cmOutreachEvents.externalId), eq(cmOutreachEvents.channel, "email")));
  const fetched = await mapLimit(stored, CONCURRENCY, async (row) => ({ row, msg: await fetchers.getMessage(accessToken, row.externalId!) }));
  const pdfs: { partnershipId: string; filename: string }[] = [];
  for (const { row, msg } of fetched.ok) {
    if (row.senderRole === "other") continue;
    const subject = header(msg.payload, "Subject");
    const found = pdfAttachments(msg.payload).filter((a) => (!a.size || a.size <= MAX_CONTRACT_BYTES) && (row.senderRole !== "team" || looksLikeContract(a.filename, subject)));
    for (const a of found) pdfs.push({ partnershipId: row.partnershipId, filename: a.filename });
    if (opts.apply && found.length) {
      await db
        .insert(cmContracts)
        .values(
          found.map((a) => ({
            partnershipId: row.partnershipId,
            source: "email" as const,
            filename: safeFilename(a.filename),
            sizeBytes: a.size || null,
            outreachEventId: row.id,
            gmailMessageId: row.externalId!,
            gmailPartId: a.partId,
            receivedAt: row.occurredAt,
          })),
        )
        .onConflictDoNothing();
    }
  }
  if (opts.apply) {
    // Everything recorded, a batch at a time.
    for (let i = 0; i < 20; i++) {
      const r = await downloadContracts(accessToken, DOWNLOADS_PER_CHECK, fetchers);
      if (r.downloaded + r.failed === 0) break;
    }
  }
  return { messages: fetched.ok.length, pdfs, errors: fetched.failed };
}

/**
 * Called after every page render (via after()): keeps email current while
 * anyone is using the app, without a cron. Never throws — a failure is
 * already recorded on the account and shown on Today and in Settings.
 */
export async function ensureFreshEmail(): Promise<void> {
  try {
    const account = await getActiveGmailAccount();
    if (!account) return;
    if (account.lastSyncAt && Date.now() - account.lastSyncAt.getTime() < FRESH_FOR_MS) return;
    if (account.syncLeaseUntil && account.syncLeaseUntil > new Date()) return;
    await runEmailCheck("visit");
  } catch {
    /* recorded on the account row / job heartbeat */
  }
}

/**
 * Called (via after()) when someone saves a new creator address: its 180-day
 * history is searched now instead of at the next visit. Busy is fine — the
 * running check or the next one picks the address up.
 */
export async function checkEmailForNewAddress(): Promise<void> {
  try {
    if (!(await getActiveGmailAccount())) return;
    await runEmailCheck("address");
  } catch {
    /* recorded on the account row / job heartbeat */
  }
}

export interface RefreshChange {
  externalId: string;
  partnershipId: string;
  subject: string | null;
  before: { direction: string; kind: string };
  after: { direction: string; kind: string };
}

/**
 * Re-download every stored email and rebuild how it's recorded (body, cc,
 * Message-ID, direction, invite/auto-reply notes), then re-sequence kinds.
 * Never moves a message to another partnership and never moves a stage.
 */
export async function refreshStoredEmails(opts: { apply: boolean }): Promise<{ checked: number; changes: RefreshChange[]; errors: number }> {
  const account = await getActiveGmailAccount();
  if (!account) throw new Error("No Gmail account connected");
  const accessToken = await refreshAccessToken(decrypt(account.refreshTokenEnc));
  const [roster, team] = await Promise.all([getEmailRoster(), loadTeamIdentity(account.email, account.teamAddresses ?? [])]);
  const creatorsByAddress = new Map<string, string[]>();
  for (const c of roster) for (const a of c.addresses) creatorsByAddress.set(a, [...(creatorsByAddress.get(a) ?? []), c.creatorId]);

  const stored = await db
    .select({
      id: cmOutreachEvents.id,
      externalId: cmOutreachEvents.externalId,
      partnershipId: cmOutreachEvents.partnershipId,
      direction: cmOutreachEvents.direction,
      kind: cmOutreachEvents.kind,
    })
    .from(cmOutreachEvents)
    .where(isNotNull(cmOutreachEvents.externalId));

  const changes: RefreshChange[] = [];
  const touched = new Set<string>();
  const fetched = await mapLimit(stored, CONCURRENCY, async (row) => ({
    row,
    msg: normalizeMessage(await getMessage(accessToken, row.externalId!)),
  }));
  for (const { row, msg } of fetched.ok) {
    if (!msg) continue;
    const c = classifyMessage(msg, creatorsByAddress, team);
    const direction = c?.direction ?? row.direction;
    const kind = c?.note ? "note" : row.kind === "note" ? (direction === "inbound" ? "reply" : "follow_up") : row.kind;
    if (direction !== row.direction || kind !== row.kind) {
      changes.push({
        externalId: row.externalId!,
        partnershipId: row.partnershipId,
        subject: msg.subject,
        before: { direction: row.direction, kind: row.kind },
        after: { direction, kind },
      });
    }
    touched.add(row.partnershipId);
    if (opts.apply) {
      await db
        .update(cmOutreachEvents)
        .set({
          direction,
          kind,
          body: cleanEmailBody(msg.bodyText),
          subject: msg.subject,
          fromAddress: msg.from,
          toAddress: msg.to.join(", ") || null,
          ccAddress: msg.cc.join(", ") || null,
          messageId: msg.messageId,
          senderRole: c?.senderRole ?? null,
          threadId: msg.threadId,
        })
        .where(eq(cmOutreachEvents.id, row.id));
    }
  }
  if (opts.apply) await recomputeEmailKinds([...touched]);
  return { checked: fetched.ok.length, changes, errors: fetched.failed };
}

/** Creator addresses the check has searched but found no mail for, and addresses shared by several creators. */
export async function getEmailCoverage(): Promise<{
  searchedNoMail: { address: string; creator: string }[];
  shared: { address: string; creators: string[] }[];
}> {
  const [account, roster] = await Promise.all([getActiveGmailAccount(), getEmailRoster()]);
  const searched = new Set(account?.backfilledAddresses ?? []);
  const rows = await db
    .select({ from: cmOutreachEvents.fromAddress, to: cmOutreachEvents.toAddress, cc: cmOutreachEvents.ccAddress })
    .from(cmOutreachEvents)
    .where(eq(cmOutreachEvents.channel, "email"));
  const seen = new Set<string>();
  for (const r of rows) {
    for (const h of [r.from, r.to, r.cc]) {
      for (const part of (h ?? "").split(",")) {
        const a = normAddress(part);
        if (a.includes("@")) seen.add(a);
      }
    }
  }
  const owners = new Map<string, string[]>();
  for (const c of roster) for (const a of c.addresses) owners.set(a, [...(owners.get(a) ?? []), c.name]);
  return {
    searchedNoMail: [...owners.entries()]
      .filter(([a]) => searched.has(a) && !seen.has(a))
      .map(([address, names]) => ({ address, creator: names[0] })),
    shared: [...owners.entries()].filter(([, names]) => names.length > 1).map(([address, creators]) => ({ address, creators })),
  };
}

/** Count of stored email messages. */
export async function countStoredEmails(): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(cmOutreachEvents).where(eq(cmOutreachEvents.channel, "email"));
  return r?.n ?? 0;
}

/**
 * For page components: once the page has been sent, check email if the last
 * check is older than FRESH_FOR_MS. Pages (not the layout) call this, because
 * a layout isn't re-rendered on every navigation — through
 * scheduleEmailCheckForVisitor (page-email-check.ts), so only signed in.
 */
export function scheduleEmailCheck(): void {
  after(() => ensureFreshEmail());
}
