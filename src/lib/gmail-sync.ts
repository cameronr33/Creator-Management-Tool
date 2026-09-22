import { eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmGmailAccounts, cmOutreachEvents, type CmGmailAccount } from "@/lib/db/schema";
import { decrypt } from "@/lib/encryption";
import { describeSyncOutcome } from "@/lib/gmail-sync-outcome";
import {
  refreshAccessToken,
  buildSearchQueries,
  listMessageIds,
  getMessage,
  normalizeMessage,
  emailDomain,
  type NormalizedGmailMessage,
} from "@/lib/gmail";
import { getEmailRoster, ingestEmails, type IngestEmailsResult } from "@/lib/email-ingest";

/**
 * The in-app email sync: connected Gmail account → search threads involving
 * roster addresses → normalize → ingestEmails (matching, dedup on message id,
 * auto-stage). Runs from the twice-daily cron and the Settings "Sync now"
 * button.
 *
 * It only ever searches for the addresses of creators someone entered into
 * the app. Nothing else in the mailbox is read or stored — the mailbox is a
 * broad work inbox, and anyone not on the roster is none of this tool's
 * business.
 */

export const DEFAULT_WINDOW_DAYS = 14;
export const BACKFILL_WINDOW_DAYS = 90;
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

    let messagesFetched = 0;
    let fetchErrors = 0;
    let result: IngestEmailsResult = { inserted: 0, skipped: 0, unmatched: [], stageChanges: [] };
    if (known.size > 0) {
      const r = await fetchMessagesFor(accessToken, [...known], windowDays);
      messagesFetched = r.messages.length;
      fetchErrors += r.fetchErrors;
      result = await ingestEmails(r.messages, { roster, teamDomain });
    }

    const summary: SyncRunResult = {
      account: account.email,
      windowDays,
      rosterSize: roster.length,
      messagesFetched,
      fetchErrors,
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
            windowDays: summary.windowDays,
          }
        : null,
    })
    .where(eq(cmGmailAccounts.id, accountId));
}
