import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cmCreators,
  cmPartnerships,
  cmAlerts,
  type CmAlertType,
} from "@/lib/db/schema";
import { getOutreachStates, getFollowUpThresholdsByClient } from "@/lib/queries";
import { DEFAULT_THRESHOLDS } from "@/lib/outreach";

export interface SweepResult {
  scanned: number;
  alertsOpened: number;
  alertsResolved: number;
  movedToNoResponse: number;
  closuresNeedingReview: number;
}

/**
 * The follow-up loop. Idempotent: run it as often as you like. It opens at most
 * one alert of each type per partnership, resolves alerts that no longer apply
 * (they replied, or moved stage). Silence after the second follow-up is counted
 * for manual review in Today; incomplete mailbox coverage cannot prove no reply.
 */
export async function runFollowUpSweep(clientId?: string): Promise<SweepResult> {
  const conds = [inArray(cmPartnerships.stage, ["shortlisted", "contacted"] as const)];
  const partnerships = await db
    .select({
      id: cmPartnerships.id,
      stage: cmPartnerships.stage,
      clientId: cmCreators.clientId,
    })
    .from(cmPartnerships)
    .innerJoin(cmCreators, eq(cmPartnerships.creatorId, cmCreators.id))
    .where(clientId ? and(eq(cmCreators.clientId, clientId), ...conds) : and(...conds));

  const ids = partnerships.map((p) => p.id);
  const [states, thresholdsByClient] = await Promise.all([
    getOutreachStates(ids),
    getFollowUpThresholdsByClient([...new Set(partnerships.map((p) => p.clientId))]),
  ]);

  // Existing open alerts, to diff against.
  const existingAlerts = ids.length
    ? await db
        .select({ id: cmAlerts.id, partnershipId: cmAlerts.partnershipId, type: cmAlerts.type })
        .from(cmAlerts)
        .where(and(inArray(cmAlerts.partnershipId, ids), eq(cmAlerts.status, "open")))
    : [];
  const openByPartnership = new Map<string, Map<string, string>>();
  for (const a of existingAlerts) {
    const m = openByPartnership.get(a.partnershipId) ?? new Map();
    m.set(a.type, a.id);
    openByPartnership.set(a.partnershipId, m);
  }

  let alertsOpened = 0;
  let alertsResolved = 0;
  let closuresNeedingReview = 0;

  for (const p of partnerships) {
    const st = states.get(p.id);
    const t = thresholdsByClient.get(p.clientId) ?? DEFAULT_THRESHOLDS;
    const wanted: { type: CmAlertType } | null = (() => {
      if (!st) return null;
      if (st.hasReplied) return null;
      // Migrated sheet rows have no real dates — never alert or auto-close on them.
      if (st.datesAreMigrated) return null;
      if (p.stage === "shortlisted" && st.totalOutbound === 0) {
        return { type: "initial_outreach_due" };
      }
      const days = st.daysSinceLastOutbound;
      if (days == null) return null;
      if (st.followUpCount >= 2 && days >= t.markNoResponseAfterDays) return null; // review in Today
      if (st.followUpCount === 0 && days >= t.followUp1AfterDays) return { type: "follow_up_1_due" };
      if (st.followUpCount === 1 && days >= t.followUp2AfterDays) return { type: "follow_up_2_due" };
      return null;
    })();

    // A recent Gmail check still cannot see replies that omit the shared mailbox,
    // or replies on another channel. No durable completeness guarantee exists,
    // so preserve the stage and let a teammate review before closing the deal.
    if (st && !st.hasReplied && !st.datesAreMigrated && st.followUpCount >= 2 && (st.daysSinceLastOutbound ?? 0) >= t.markNoResponseAfterDays) {
      closuresNeedingReview++;
    }

    const existing = openByPartnership.get(p.id) ?? new Map();

    // Resolve open alerts that no longer match what we want.
    for (const [type, id] of existing) {
      if (!wanted || wanted.type !== type) {
        await db.update(cmAlerts).set({ status: "done", updatedAt: new Date() }).where(eq(cmAlerts.id, id));
        alertsResolved++;
      }
    }

    // Open the wanted alert if not already open.
    if (wanted && !existing.has(wanted.type)) {
      await db
        .insert(cmAlerts)
        .values({ partnershipId: p.id, type: wanted.type, dueAt: new Date(), status: "open" })
        .onConflictDoUpdate({
          target: [cmAlerts.partnershipId, cmAlerts.type],
          set: { status: "open", dueAt: new Date(), snoozedUntil: null, updatedAt: new Date() },
        });
      alertsOpened++;
    }
  }

  return {
    scanned: partnerships.length,
    alertsOpened,
    alertsResolved,
    movedToNoResponse: 0,
    closuresNeedingReview,
  };
}
