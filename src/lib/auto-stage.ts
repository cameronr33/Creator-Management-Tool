import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmPartnerships, type CmStage } from "@/lib/db/schema";
import { moveStage } from "@/lib/stage-moves";

/**
 * Auto-stage rule table — advances a partnership's stage when the app
 * observes a real-world event that unambiguously implies it, so nobody
 * hand-moves a dropdown after every action.
 *
 * Deliberately conservative: the from-stage allowlist IS the guard. Any stage
 * not listed for a trigger is a no-op, so this never moves a stage backward,
 * never closes a deal (passed / declined / no_response are always a
 * person's call), and never decides "Talking → Agreed" — that one is read
 * from the creator's own email (email-status.ts) or set by a person.
 *
 * The one reopen: a creator closed as No response who writes back moves to
 * Talking on their own reply.
 *
 * Frozen node 2 (AGENTS.md): the full matrix is asserted in
 * scripts/verify-auto-stage.ts — edit both or neither.
 */

export type AutoStageTrigger =
  | "outbound_message"
  | "inbound_message"
  | "address_complete"
  | "contract_unsigned"
  | "deal_ready"
  | "shipment_shipped"
  | "shipment_delivered"
  | "deliverable_added";

/**
 * Exported so the UI can *show* the rules (the Help page and the stage
 * control) from the same table the engine runs — never a hand-copied list.
 */
export const AUTO_STAGE_RULES: Record<AutoStageTrigger, { from: CmStage[]; to: CmStage }> = {
  outbound_message: { from: ["shortlisted"], to: "contacted" },
  inbound_message: { from: ["contacted", "no_response"], to: "in_conversation" },
  address_complete: { from: ["awaiting_address"], to: "fulfilling" },
  // Finalizing (2026-09-25): an unsigned contract means the deal is still being
  // worked out; it leaves only when signed AND the address is in (dealIsReady).
  contract_unsigned: { from: ["awaiting_address"], to: "finalizing" },
  deal_ready: { from: ["finalizing"], to: "fulfilling" },
  shipment_shipped: { from: ["awaiting_address", "finalizing", "fulfilling"], to: "shipped" },
  shipment_delivered: { from: ["awaiting_address", "finalizing", "fulfilling", "shipped"], to: "content_pending" },
  deliverable_added: { from: ["fulfilling", "shipped", "content_pending"], to: "posted" },
};

/** Pure rule lookup: the stage this trigger advances `current` to, or null. */
export function nextStageFor(current: CmStage, trigger: AutoStageTrigger): CmStage | null {
  const rule = AUTO_STAGE_RULES[trigger];
  return rule.from.includes(current) ? rule.to : null;
}

export interface AutoStageResult {
  from: CmStage;
  to: CmStage;
}

/**
 * Apply the rule table to a partnership through the stage-move core
 * (compare-and-set on the stage it evaluated; a lost race re-reads once and
 * re-evaluates). Returns the transition or null.
 */
export async function applyAutoStage(
  partnershipId: string,
  trigger: AutoStageTrigger,
  userId?: string,
  /** `meta`: who set it off when it wasn't a teammate (a person at the client, through the portal). */
  opts: { evidenceEventId?: string | null; meta?: Record<string, unknown> } = {},
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

    const r = await moveStage({
      partnershipId,
      to,
      source: "rule",
      userId: userId ?? null,
      expectFrom: row.stage,
      reason: trigger,
      evidenceEventId: opts.evidenceEventId ?? null,
      meta: { trigger, ...(opts.meta ?? {}) },
    });
    if (r.status === "moved") return { from: r.from, to: r.to };
    if (r.status !== "stale") return null;
  }
  return null;
}

/** Pure: Finalizing is done — the deal is signed and a complete address is on file. */
export function dealIsReady(p: { agreementType: string | null; addressLine1?: string | null; city?: string | null; region?: string | null; postalCode?: string | null }): boolean {
  return p.agreementType === "signed" && !!(p.addressLine1?.trim() && p.city?.trim() && p.region?.trim() && p.postalCode?.trim());
}

/**
 * After the deal or the address changed: a Finalizing partnership that's now
 * signed with an address moves to Ready to ship (rule `deal_ready`).
 */
export async function advanceIfDealReady(partnershipId: string, userId?: string, meta?: Record<string, unknown>): Promise<AutoStageResult | null> {
  const [p] = await db
    .select({
      stage: cmPartnerships.stage,
      agreementType: cmPartnerships.agreementType,
      addressLine1: cmPartnerships.addressLine1,
      city: cmPartnerships.city,
      region: cmPartnerships.region,
      postalCode: cmPartnerships.postalCode,
    })
    .from(cmPartnerships)
    .where(eq(cmPartnerships.id, partnershipId))
    .limit(1);
  if (!p || p.stage !== "finalizing" || !dealIsReady(p)) return null;
  return applyAutoStage(partnershipId, "deal_ready", userId, { meta });
}
