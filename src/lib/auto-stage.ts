import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmPartnerships, type CmStage } from "@/lib/db/schema";
import { changeStage } from "@/lib/mutations";

/**
 * Auto-stage engine — advances a partnership's stage when the app observes a
 * real-world event that unambiguously implies it, so the operator stops
 * hand-moving a dropdown after every action.
 *
 * Deliberately conservative: the from-stage allowlist IS the guard. Any stage
 * not listed for a trigger is a no-op, so this can never move a stage
 * backward, never touches terminal stages (passed/declined/no_response), and
 * never overrides judgment stages — nothing auto-moves to `negotiating`,
 * `agreed`, `awaiting_address`, or `completed`; those stay human decisions.
 */

export type AutoStageTrigger =
  | "outbound_message"
  | "inbound_message"
  | "address_complete"
  | "shipment_shipped"
  | "shipment_delivered"
  | "deliverable_added";

const RULES: Record<AutoStageTrigger, { from: CmStage[]; to: CmStage }> = {
  outbound_message: { from: ["researched", "shortlisted"], to: "contacted" },
  inbound_message: { from: ["contacted"], to: "in_conversation" },
  address_complete: { from: ["awaiting_address"], to: "fulfilling" },
  shipment_shipped: { from: ["agreed", "awaiting_address"], to: "fulfilling" },
  shipment_delivered: {
    from: ["agreed", "awaiting_address", "fulfilling"],
    to: "content_pending",
  },
  deliverable_added: { from: ["fulfilling", "content_pending"], to: "posted" },
};

/** Pure rule lookup: the stage this trigger advances `current` to, or null. */
export function nextStageFor(
  current: CmStage,
  trigger: AutoStageTrigger,
): CmStage | null {
  const rule = RULES[trigger];
  return rule.from.includes(current) ? rule.to : null;
}

export interface AutoStageResult {
  from: CmStage;
  to: CmStage;
}

/**
 * Apply the rule table to a partnership. Delegates to changeStage so
 * cm_stage_transitions keeps its audit trail. Returns the transition that
 * happened, or null when the rules say no-op (or the partnership is gone).
 */
export async function applyAutoStage(
  partnershipId: string,
  trigger: AutoStageTrigger,
  userId?: string,
): Promise<AutoStageResult | null> {
  const [row] = await db
    .select({ stage: cmPartnerships.stage })
    .from(cmPartnerships)
    .where(eq(cmPartnerships.id, partnershipId))
    .limit(1);
  if (!row) return null;

  const to = nextStageFor(row.stage, trigger);
  if (!to) return null;

  await changeStage(partnershipId, to, userId);
  return { from: row.stage, to };
}
