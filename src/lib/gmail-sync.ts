import { eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmGmailAccounts, cmOutreachEvents, type CmGmailAccount } from "@/lib/db/schema";
import { decrypt } from "@/lib/encryption";
import { describeSyncOutcome } from "@/lib/gmail-sync-outcome";
import {
  refreshAccessToken,
  buildSearchQueries,
  buildDiscoveryQuery,
  listMessageIds,
  getMessage,
  getMessageMetadata,
  normalizeMessage,
  parseEmailAddress,
  emailDomain,
  header,
  type NormalizedGmailMessage,
} from "@/lib/gmail";
import { getEmailRoster, ingestEmails, type IngestEmailsResult } from "@/lib/email-ingest";
import {
  recordSuggestions,
  countOpenSuggestions,
  getAllCreatorRefs,
  getCreatorEmails,
  type ObservedAddress,
} from "@/lib/email-suggestions";

/**
 * The in-app email sync: connected Gmail account → search threads involving
 * roster addresses → normalize → ingestEmails (matching, dedup on message id,
 * auto-stage). Runs from the twice-daily cron and the Settings "Sync now"
 * button — no Claude session anywhere in the loop.
 *
 * Two passes per run:
 *   1. MATCH  — threads involving addresses the app already knows.
 *   2. DISCOVER — the cc'd outreach threads themselves; every external
 *      address that matched nothing becomes an open suggestion. This is the
 *      sync's reality anchor: "0 matched" is only healthy when this is empty.
 */

export const DEFAULT_WINDOW_DAYS = 14;
export const BACKFILL_WINDOW_DAYS = 90;
const DISCOVERY_MESSAGE_CAP = 300;
const MATCH_MESSAGE_CAP = 1000;
const CONCURRENCY = 8;

export async function getActiveGmailAccount(): Promise<CmGmailAccount | null> {
  const [account] = await db
    .select()
    .from(cmGmailAccounts)
    .where(eq(cmGmailAccounts.isActive, true))
    .limit(1);
  return account ?? null;
}

export interface SyncRunResult extends IngestEmailsResult {
  account: string;
  windowDays: number;
  rosterSize: number;
  messagesFetched: number;
  /** Individual message fetches that failed and were skipped (not fatal). */
  fetchErrors: number;
  /** External addresses seen on cc'd threads that match no creator (open). */
  suggestionsOpen: number;
}

/** Run `fn` over `items` with at most `limit` in flight; failures are returned, not thrown. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<{ ok: R[]; failed: number }> {
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

async function hasSyncedEvents(): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cmOutreachEvents)
    .where(isNotNull(cmOutreachEvents.externalId));
  return (row?.n ?? 0) > 0;
}

/** Fetch + normalize every message involving `addresses` (bounded, fault-tolerant). */
async function fetchMessagesFor(
  accessToken: string,
  addresses: string[],
  windowDays: number,
): Promise<{ messages: NormalizedGmailMessage[]; fetchErrors: number }> {
  const lists = await mapLimit(buildSearchQueries(addresses, windowDays), 4, (q) =>
    listMessageIds(accessToken, q),
  );
  const ids = [...new Set(lists.ok.flat())].slice(0, MATCH_MESSAGE_CAP);
  const fetched = await mapLimit(ids, CONCURRENCY, (id) => getMessage(accessToken, id));
  const messages = fetched.ok
    .map(normalizeMessage)
    .filter((m): m is NormalizedGmailMessage => m !== null);
  return { messages, fetchErrors: lists.failed + fetched.failed };
}

/**
 * Scan cc'd threads (headers only) and tally every external address that
 * isn't already known. Same-domain addresses are the team, not creators.
 */
async function discoverAddresses(
  accessToken: string,
  mailbox: string,
  windowDays: number,
  known: Set<string>,
): Promise<{ observed: ObservedAddress[]; fetchErrors: number }> {
  const teamDomain = emailDomain(mailbox);
  const ids = await listMessageIds(accessToken, buildDiscoveryQuery(mailbox, windowDays), DISCOVERY_MESSAGE_CAP);
  const fetched = await mapLimit(ids, CONCURRENCY, (id) => getMessageMetadata(accessToken, id));
  const observed = new Map<string, ObservedAddress>();

  for (const msg of fetched.ok) {
    const ts = Number(msg.internalDate);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const at = new Date(ts);
    const subject = header(msg.payload, "Subject");
    const raws = [
      header(msg.payload, "From") ?? "",
      ...(header(msg.payload, "To") ?? "").split(","),
      ...(header(msg.payload, "Cc") ?? "").split(","),
    ];
    for (const raw of raws) {
      const parsed = parseEmailAddress(raw);
      if (!parsed) continue;
      const { email, name } = parsed;
      if (email === mailbox.toLowerCase()) continue;
      if (emailDomain(email) === teamDomain) continue;
      if (known.has(email)) continue;
      const cur = observed.get(email);
      if (cur) {
        cur.count += 1;
        if (at < cur.firstSeenAt) cur.firstSeenAt = at;
        if (at > cur.lastSeenAt) cur.lastSeenAt = at;
        if (!cur.displayName && name) cur.displayName = name;
        if (!cur.sampleSubject && subject) cur.sampleSubject = subject;
      } else {
        observed.set(email, { email, displayName: name, count: 1, firstSeenAt: at, lastSeenAt: at, sampleSubject: subject });
      }
    }
  }
  return { observed: [...observed.values()], fetchErrors: fetched.failed };
}

/**
 * Run one sync pass. The window defaults to 90 days until the first message
 * has ever been captured (backfill), then 14 days — dedup on the Gmail
 * message id makes overlap harmless.
 */
export async function runGmailSync(opts: { windowDays?: number } = {}): Promise<SyncRunResult> {
  const account = await getActiveGmailAccount();
  if (!account) throw new Error("No Gmail account connected — connect one in Settings.");

  try {
    const windowDays =
      opts.windowDays ?? ((await hasSyncedEvents()) ? DEFAULT_WINDOW_DAYS : BACKFILL_WINDOW_DAYS);
    const accessToken = await refreshAccessToken(decrypt(account.refreshTokenEnc));
    const teamDomain = emailDomain(account.email);

    const roster = await getEmailRoster();
    const known = new Set(roster.map((c) => c.businessEmail.toLowerCase()));

    // Pass 1 — match known addresses.
    let messagesFetched = 0;
    let fetchErrors = 0;
    let result: IngestEmailsResult = { inserted: 0, skipped: 0, unmatched: [], stageChanges: [] };
    if (known.size > 0) {
      const r = await fetchMessagesFor(accessToken, [...known], windowDays);
      messagesFetched = r.messages.length;
      fetchErrors += r.fetchErrors;
      result = await ingestEmails(r.messages, { roster, teamDomain });
    }

    // Pass 2 — discover addresses on cc'd threads that the app doesn't know.
    const discovery = await discoverAddresses(accessToken, account.email, windowDays, known);
    fetchErrors += discovery.fetchErrors;
    if (discovery.observed.length > 0) {
      await recordSuggestions(discovery.observed, await getAllCreatorRefs());
    }
    const suggestionsOpen = await countOpenSuggestions();

    const summary: SyncRunResult = {
      account: account.email,
      windowDays,
      rosterSize: roster.length,
      messagesFetched,
      fetchErrors,
      suggestionsOpen,
      ...result,
    };
    // Status is specific, not a bare "ok": a run that could not have matched
    // anything must not look like a healthy quiet day.
    await recordSync(account.id, describeSyncOutcome(summary), summary);
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordSync(account.id, `error: ${message}`, null);
    throw err;
  }
}

/**
 * After an address is linked to a creator, pull that creator's threads right
 * away instead of waiting for the next scheduled run.
 */
export async function syncCreatorNow(
  creatorId: string,
  windowDays = BACKFILL_WINDOW_DAYS,
): Promise<{ messagesFetched: number; result: IngestEmailsResult } | null> {
  const account = await getActiveGmailAccount();
  if (!account) return null;
  const emails = (await getCreatorEmails(creatorId)).map((e) => e.email);
  if (emails.length === 0) return null;
  const accessToken = await refreshAccessToken(decrypt(account.refreshTokenEnc));
  const { messages } = await fetchMessagesFor(accessToken, emails, windowDays);
  const result = await ingestEmails(messages, { teamDomain: emailDomain(account.email) });
  return { messagesFetched: messages.length, result };
}

async function recordSync(
  accountId: string,
  status: string,
  summary: SyncRunResult | null,
): Promise<void> {
  await db
    .update(cmGmailAccounts)
    .set({
      lastSyncAt: new Date(),
      lastSyncStatus: status,
      lastSyncSummary: summary
        ? {
            inserted: summary.inserted,
            skipped: summary.skipped,
            unmatched: summary.unmatched.length,
            stageChanges: summary.stageChanges.length,
            messagesFetched: summary.messagesFetched,
            fetchErrors: summary.fetchErrors,
            rosterSize: summary.rosterSize,
            suggestionsOpen: summary.suggestionsOpen,
            windowDays: summary.windowDays,
          }
        : null,
    })
    .where(eq(cmGmailAccounts.id, accountId));
}
