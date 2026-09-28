import type { CmStage } from "@/lib/db/schema";
import { canonicalStage } from "@/lib/stages";

/**
 * Snooze (owner, 2026-09-28): hide a creator from Today until a date. Pure —
 * no database — so Today, the creator page and the tests share one rule.
 *
 * Asleep while ALL of these hold:
 *  - it's before the date;
 *  - the stage is still the one it was snoozed at (any move wakes it);
 *  - nothing inbound has been stored since it was snoozed — a message from
 *    them or someone on their thread, by email or a logged "They replied".
 *    Our own messages, the client's notes, invites and auto-replies never
 *    wake it. Stored time, not sent time: a reply that reaches the app late
 *    still wakes it (an old backfilled email can wake it early — the safe way).
 */

export const SNOOZE_MAX_DAYS = 180;

export interface SnoozeState {
  snoozedUntil: Date | null;
  snoozedAt: Date | null;
  snoozeStage: CmStage | null;
}

export function snoozeActive(s: SnoozeState & { stage: CmStage; lastInboundStoredAt: Date | null; now?: Date }): boolean {
  if (!s.snoozedUntil || !s.snoozedAt || !s.snoozeStage) return false;
  const now = s.now ?? new Date();
  if (now.getTime() >= s.snoozedUntil.getTime()) return false;
  if (canonicalStage(s.stage) !== canonicalStage(s.snoozeStage)) return false;
  if (s.lastInboundStoredAt && s.lastInboundStoredAt.getTime() > s.snoozedAt.getTime()) return false;
  return true;
}

export type ParsedSnooze = { ok: true; until: Date } | { ok: false; error: string };

/** The date must be in the future and no more than 180 days away. */
export function parseSnoozeUntil(raw: string, now = new Date()): ParsedSnooze {
  const until = new Date(raw);
  if (Number.isNaN(until.getTime())) return { ok: false, error: "That isn't a date" };
  if (until.getTime() <= now.getTime()) return { ok: false, error: "Pick a date after today" };
  if (until.getTime() > now.getTime() + SNOOZE_MAX_DAYS * 86_400_000) return { ok: false, error: `Snooze for at most ${SNOOZE_MAX_DAYS} days` };
  return { ok: true, until };
}
