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
  /**
   * The last time a person or a rule set the stage (lastStageDecisionAt) — a
   * contract or an address can know more than the emails do. The email
   * reader's own moves, the one-time clean-up and a quick Undo don't count:
   * the flag is how a person checks those.
   */
  decidedAt: Date | null;
  /** Any shipment on file: moving back would leave it behind, so never ask. */
  hasShipment?: boolean;
  /** "Keep …" pressed: the flag stays away until a newer message reads differently. */
  dismissedAt: Date | null;
}

/** The earlier stage to suggest, or null when there's nothing to ask. */
export function staleStage(f: StageFlagFacts): CmStage | null {
  if (!f.emailStage || !f.emailStageAt) return null;
  const current = canonicalStage(f.stage);
  const suggested = canonicalStage(f.emailStage);
  if (!FLAGGABLE_STAGES.includes(current) || f.hasShipment) return null;
  if (isTerminal(suggested) || stageIndex(suggested) >= stageIndex(current)) return null;
  // A person's or a rule's move after that message wins, and so does "Keep" after it.
  if (f.decidedAt && f.emailStageAt.getTime() <= f.decidedAt.getTime()) return null;
  if (f.dismissedAt && f.emailStageAt.getTime() <= f.dismissedAt.getTime()) return null;
  return suggested;
}

/** "Their emails read as Talking, not Agreed" */
export function staleStageLine(current: CmStage, suggested: CmStage): string {
  return `Their emails read as ${stageLabel(suggested)}, not ${stageLabel(current)}`;
}
