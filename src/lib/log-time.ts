/**
 * When a hand-logged message happened (pure — the log panel in the browser
 * and the server share these limits; src/lib/logging.ts does the logging).
 */

export const LOG_MAX_PAST_DAYS = 180;
const FUTURE_SLACK_MS = 5 * 60_000;

export type ResolvedTime = { ok: true; at: Date; supplied: boolean } | { ok: false; error: string };

/** Pure: when the logged message happened — now if not given; never in the future; at most 180 days back. */
export function resolveOccurredAt(raw: string | null | undefined, now = new Date()): ResolvedTime {
  if (!raw) return { ok: true, at: now, supplied: false };
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return { ok: false, error: "That isn't a date" };
  if (at.getTime() > now.getTime() + FUTURE_SLACK_MS) return { ok: false, error: "That's in the future — pick today or earlier" };
  if (at.getTime() < now.getTime() - LOG_MAX_PAST_DAYS * 86_400_000) return { ok: false, error: `Pick a date within the last ${LOG_MAX_PAST_DAYS} days` };
  return { ok: true, at: at.getTime() > now.getTime() ? now : at, supplied: true };
}
