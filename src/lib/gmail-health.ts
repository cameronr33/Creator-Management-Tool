/** Presentation only: a recent heartbeat is not proof of complete mailbox coverage. */
export interface GmailHealthInput {
  lastSyncAt: Date | string | null;
  lastSyncStatus: string | null;
  lastSyncSummary?: unknown;
}

export interface GmailHealthSummary {
  state: "disconnected" | "never" | "error" | "partial" | "stale" | "idle" | "checked" | "unknown";
  tone: "info" | "good" | "warn" | "bad";
  label: string;
  detail: string;
  stale: boolean;
  fetchErrors: number;
  lastCheckedAt: string | null;
}

function asSummary(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

// Visits check every 15 minutes and the worker twice a day; a check older than
// this means nobody has had the app open and the worker isn't running.
export const GMAIL_STALE_AFTER_HOURS = 18;

export function summarizeGmailHealth(
  account: GmailHealthInput | null,
  now = new Date(),
): GmailHealthSummary {
  const base = { stale: false, fetchErrors: 0, lastCheckedAt: null };
  if (!account) {
    return { ...base, state: "disconnected", tone: "warn", label: "Mailbox not connected", detail: "Connect the shared mailbox in Settings to start tracking creator email." };
  }
  const status = account.lastSyncStatus?.toLowerCase() ?? "";
  const summary = asSummary(account.lastSyncSummary);
  const legacySkipped = Number(status.match(/(\d+) message fetch\(es\) skipped/)?.[1] ?? 0);
  const fetchErrors = Math.max(count(summary.fetchErrors), legacySkipped);
  const at = account.lastSyncAt == null ? null : new Date(account.lastSyncAt);
  const validAt = at != null && Number.isFinite(at.getTime()) && at.getTime() <= now.getTime() + 60_000;
  const stale = validAt && (now.getTime() - at.getTime()) / 3_600_000 > GMAIL_STALE_AFTER_HOURS;
  const facts = { stale, fetchErrors, lastCheckedAt: validAt ? at.toISOString() : null };
  const late = stale ? " The last check is also overdue." : "";

  if (status.startsWith("error")) {
    return { ...facts, state: "error", tone: "bad", label: "Email check failed", detail: `The last email check failed. Check the mailbox connection in Settings, then try again.${late}` };
  }
  if (account.lastSyncAt == null) {
    return { ...facts, state: "never", tone: "warn", label: "Email not checked yet", detail: "The mailbox is connected, but no check has been recorded." };
  }
  if (!validAt) {
    return { ...facts, state: "unknown", tone: "warn", label: "Email timing unknown", detail: "The last check has an invalid timestamp. Its freshness cannot be confirmed." };
  }
  if (fetchErrors > 0 || status.startsWith("partial")) {
    return { ...facts, state: "partial", tone: "warn", label: "Email check incomplete", detail: `${fetchErrors > 0 ? `${fetchErrors} message${fetchErrors === 1 ? "" : "s"} couldn't be read.` : "Part of the latest check did not finish."} Some replies may be missing, so check again.${late}` };
  }
  if (stale) {
    return { ...facts, state: "stale", tone: "warn", label: "Email check overdue", detail: "No check has been recorded in over 18 hours. Recent replies may be missing." };
  }
  if (status.startsWith("idle")) {
    return { ...facts, state: "idle", tone: "warn", label: "No creator addresses to match", detail: "No creator has an email address yet, so there is nothing to track. Add their email on the creator page." };
  }
  if (status !== "ok") {
    return { ...facts, state: "unknown", tone: "warn", label: "Email result unknown", detail: "The last check didn't say whether it finished. Check again to be sure." };
  }
  return { ...facts, state: "checked", tone: "info", label: "Email checked recently", detail: "Everything the mailbox holds for your creators is up to date." };
}
