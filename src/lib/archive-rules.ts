import type { CmStage } from "@/lib/db/schema";
import { canonicalStage } from "@/lib/stages";

/**
 * Archive (owner, 2026-09-29: "an archive button for the creators we're no
 * longer really talking to" — it replaces Snooze). Hides a creator from
 * Today, the Pipeline and the Creators list, with an optional "remind me on"
 * date. Pure — no database — so every list, the creator page and the tests
 * share one rule.
 *
 * Archived while ALL of these hold:
 *  - there's no reminder date, or it hasn't come yet;
 *  - the stage is still the one it was archived at (any move brings them
 *    back — and a stage move clears the archive, so re-entering the stage
 *    later can't archive them again: stage-moves.ts);
 *  - nothing inbound has been stored since it was archived — a message from
 *    them or someone on their thread, by email or a logged "They replied".
 *    Our own messages, the client's notes, invites and auto-replies never
 *    bring them back. Stored time, not sent time.
 */

export const ARCHIVE_REMIND_MAX_DAYS = 365;

export interface ArchiveState {
  archivedAt: Date | null;
  archivedUntil: Date | null;
  archiveStage: CmStage | null;
}

export function archiveActive(s: ArchiveState & { stage: CmStage; lastInboundStoredAt: Date | null; now?: Date }): boolean {
  if (!s.archivedAt || !s.archiveStage) return false;
  const now = s.now ?? new Date();
  if (s.archivedUntil && now.getTime() >= s.archivedUntil.getTime()) return false;
  if (canonicalStage(s.stage) !== canonicalStage(s.archiveStage)) return false;
  if (s.lastInboundStoredAt && s.lastInboundStoredAt.getTime() > s.archivedAt.getTime()) return false;
  return true;
}

/** Pure: why an archived creator is back on the lists — the reminder date came, or they wrote. Null if never archived or still archived. */
export function archiveWoke(s: ArchiveState & { stage: CmStage; lastInboundStoredAt: Date | null; now?: Date }): "reminder" | "wrote" | null {
  if (!s.archivedAt || !s.archiveStage || archiveActive(s)) return null;
  if (s.lastInboundStoredAt && s.lastInboundStoredAt.getTime() > s.archivedAt.getTime()) return "wrote";
  if (s.archivedUntil && (s.now ?? new Date()).getTime() >= s.archivedUntil.getTime()) return "reminder";
  return null;
}

export type ParsedRemind = { ok: true; until: Date | null } | { ok: false; error: string };

/** The optional "remind me on" date: none, or a date in the future no more than a year away. */
export function parseRemindOn(raw: string | null | undefined, now = new Date()): ParsedRemind {
  if (!raw) return { ok: true, until: null };
  const until = new Date(raw);
  if (Number.isNaN(until.getTime())) return { ok: false, error: "That isn't a date" };
  if (until.getTime() <= now.getTime()) return { ok: false, error: "Pick a date after today" };
  if (until.getTime() > now.getTime() + ARCHIVE_REMIND_MAX_DAYS * 86_400_000) return { ok: false, error: `Pick a date within a year` };
  return { ok: true, until };
}

/** Pure: split rows into what the lists show and what's archived. */
export function splitArchived<T extends ArchiveState & { partnershipId: string; stage: CmStage }>(rows: T[], lastInbound: Map<string, Date>, now = new Date()): { active: T[]; archived: T[] } {
  const active: T[] = [];
  const archived: T[] = [];
  for (const r of rows) (archiveActive({ ...r, lastInboundStoredAt: lastInbound.get(r.partnershipId) ?? null, now }) ? archived : active).push(r);
  return { active, archived };
}
