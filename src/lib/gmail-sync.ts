import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmGmailAccounts, type CmGmailAccount } from "@/lib/db/schema";
import { decrypt } from "@/lib/encryption";
import {
  refreshAccessToken,
  buildSearchQueries,
  listMessageIds,
  getMessage,
  normalizeMessage,
} from "@/lib/gmail";
import { getEmailRoster, ingestEmails, type IngestEmailsResult } from "@/lib/email-ingest";

/**
 * The in-app email sync: connected Gmail account → search threads involving
 * roster addresses → normalize → ingestEmails (matching, dedup on message id,
 * auto-stage). Runs from the twice-daily cron and the Settings "Sync now"
 * button — no Claude session anywhere in the loop.
 */

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
  rosterSize: number;
  messagesFetched: number;
}

/**
 * Run one sync pass. windowDays controls how far back the Gmail search goes —
 * dedup makes overlap harmless, so the default comfortably covers the
 * twice-daily cadence plus downtime.
 */
export async function runGmailSync(windowDays = 14): Promise<SyncRunResult> {
  const account = await getActiveGmailAccount();
  if (!account) throw new Error("No Gmail account connected — connect one in Settings.");

  try {
    const roster = await getEmailRoster();
    if (roster.length === 0) {
      const empty: SyncRunResult = {
        account: account.email,
        rosterSize: 0,
        messagesFetched: 0,
        inserted: 0,
        skipped: 0,
        unmatched: [],
        stageChanges: [],
      };
      await recordSync(account.id, "ok", empty);
      return empty;
    }

    const accessToken = await refreshAccessToken(decrypt(account.refreshTokenEnc));

    const queries = buildSearchQueries(
      roster.map((c) => c.businessEmail),
      windowDays,
    );
    const idSet = new Set<string>();
    for (const q of queries) {
      for (const id of await listMessageIds(accessToken, q)) idSet.add(id);
    }

    const messages = [];
    for (const id of idSet) {
      const normalized = normalizeMessage(await getMessage(accessToken, id));
      if (normalized) messages.push(normalized);
    }

    const result = await ingestEmails(messages);
    const summary: SyncRunResult = {
      account: account.email,
      rosterSize: roster.length,
      messagesFetched: messages.length,
      ...result,
    };
    await recordSync(account.id, "ok", summary);
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordSync(account.id, message, null);
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
      ...(summary
        ? {
            lastSyncSummary: {
              inserted: summary.inserted,
              skipped: summary.skipped,
              unmatched: summary.unmatched.length,
              stageChanges: summary.stageChanges.length,
              messagesFetched: summary.messagesFetched,
              rosterSize: summary.rosterSize,
            },
          }
        : {}),
    })
    .where(eq(cmGmailAccounts.id, accountId));
}
