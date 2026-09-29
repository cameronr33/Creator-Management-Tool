import type { CmStage } from "@/lib/db/schema";
import { canonicalStage, isTerminal, stageIndex, stageLabel } from "@/lib/stages";

/**
 * The stale-stage flag (owner, 2026-09-29: "flag it, one click to fix").
 * Michael Dey came in from the old sheet as Agreed; his emails say talks are
 * paused. Automation only moves a stage forward (frozen node 2), so the
 * email reader can't pull him back — instead, when the messages read as an
 * earlier stage, Today and the creator page ask a person: Move to Talking,
 * or Keep Agreed. Pure (scripts/verify-today.ts).
 */

/** Only these can be flagged: before anything ships. At Ready to ship a shipment exists, and moving back would leave it behind. */
export const FLAGGABLE_STAGES: readonly CmStage[] = ["in_conversation", "awaiting_address", "finalizing"];

export interface StageFlagFacts {
  stage: CmStage;
  /** Where the messages alone put the deal (the email reader's stage_from_messages). */
  emailStage: CmStage | null;
  /** When the message behind that was sent. */
  emailStageAt: Date | null;
  /** The last time a person set the stage (not the email reader, a rule, the one-time clean-up, or a quick Undo). */
  lastManualChangeAt: Date | null;
  /** "Keep …" pressed: the flag stays away until a newer message reads differently. */
  dismissedAt: Date | null;
}

/** The earlier stage to suggest, or null when there's nothing to ask. */
export function staleStage(f: StageFlagFacts): CmStage | null {
  if (!f.emailStage || !f.emailStageAt) return null;
  const current = canonicalStage(f.stage);
  const suggested = canonicalStage(f.emailStage);
  if (!FLAGGABLE_STAGES.includes(current)) return null;
  if (isTerminal(suggested) || stageIndex(suggested) >= stageIndex(current)) return null;
  // A person's decision after that message wins, and so does "Keep" after it.
  if (f.lastManualChangeAt && f.emailStageAt.getTime() <= f.lastManualChangeAt.getTime()) return null;
  if (f.dismissedAt && f.emailStageAt.getTime() <= f.dismissedAt.getTime()) return null;
  return suggested;
}

/** "Their emails read as Talking, not Agreed" */
export function staleStageLine(current: CmStage, suggested: CmStage): string {
  return `Their emails read as ${stageLabel(suggested)}, not ${stageLabel(current)}`;
}
