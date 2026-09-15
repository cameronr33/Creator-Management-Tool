import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmPartnerships, cmStageTransitions, type CmStage } from "@/lib/db/schema";

/**
 * Auto-stage engine — advances a partnership's stage when the app observes a
 * real-world event that unambiguously implies it, so the operator stops
 * hand-moving a dropdown after every action.
 *
 * Deliberately conservative: the from-stage allowlist IS the guard. Any stage
 * not listed for a trigger is a no-op, so this can never move a stage
 * backward in the funnel, never touches `passed`/`declined`, and never
 * overrides judgment stages — nothing auto-moves to `negotiating`, `agreed`,
 * `awaiting_address`, or `completed`; those stay human decisions.
 *
 * The one deliberate exception: a creator the follow-up loop closed as
 * `no_response` is reopened by their own late reply (`inbound_message`). The
 * loop that closes them must not blind the loop that would catch them.
 */

export type AutoStageTrigger =
  | "outbound_message"
  | "inbound_message"
  | "address_complete"
  | "shipment_shipped"
  | "shipment_delivered"
  | "deliverable_added";

/**
 * Exported so the UI can *show* the rules (the Help page and the stage
 * control) from the same table the engine runs — never a hand-copied list.
 */
export const AUTO_STAGE_RULES: Record<AutoStageTrigger, { from: CmStage[]; to: CmStage }> = {
  outbound_message: { from: ["researched", "shortlisted"], to: "contacted" },
  inbound_message: { from: ["contacted", "no_response"], to: "in_conversation" },
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
  const rule = AUTO_STAGE_RULES[trigger];
  return rule.from.includes(current) ? rule.to : null;
}

export interface AutoStageResult {
  from: CmStage;
  to: CmStage;
}

/**
 * Apply the rule table to a partnership. The write is a compare-and-set
 * (`WHERE stage = <the stage we read>`), so two concurrent events — the cron
 * sweep and a click, say — cannot both "win" from the same starting stage;
 * the loser re-reads once and re-evaluates. Every applied move lands in
 * cm_stage_transitions like a manual one. Returns the transition or null.
 */
export async function applyAutoStage(
  partnershipId: string,
  trigger: AutoStageTrigger,
  userId?: string,
): Promise<AutoStageResult | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const [row] = await db
      .select({ stage: cmPartnerships.stage })
      .from(cmPartnerships)
      .where(eq(cmPartnerships.id, partnershipId))
      .limit(1);
    if (!row) return null;

    const to = nextStageFor(row.stage, trigger);
    if (!to) return null;

    const updated = await db
      .update(cmPartnerships)
      .set({ stage: to, updatedAt: new Date() })
      .where(and(eq(cmPartnerships.id, partnershipId), eq(cmPartnerships.stage, row.stage)))
      .returning({ id: cmPartnerships.id });
    if (updated.length === 0) continue; // lost the race — re-read and retry once

    await db.insert(cmStageTransitions).values({
      partnershipId,
      fromStage: row.stage,
      toStage: to,
      changedBy: userId ?? null,
    });
    return { from: row.stage, to };
  }
  return null;
}
