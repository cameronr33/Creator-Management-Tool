import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cmCreators,
  cmPartnerships,
  cmShipments,
  cmDeliverables,
} from "@/lib/db/schema";
import { getOutreachStates, getFollowUpThresholds } from "@/lib/queries";

export interface StallItem {
  partnershipId: string;
  name: string;
  username: string;
  detail: string;
  /** Present on ready-to-ship items so the dashboard can one-click mark shipped. */
  shipmentId?: string;
  /** Follow-up queue only: what "Mark sent" should log. Explicit, not parsed from `detail`. */
  kind?: "initial" | "follow_up";
  /** True when every outbound event is a migrated sheet row with an unknown real date. */
  migrated?: boolean;
}

export interface DashboardStalls {
  followUpsDue: StallItem[];
  awaitingAddress: StallItem[];
  readyToShip: StallItem[];
  deliveredNoVideo: StallItem[];
}

/**
 * The four queues that answer "what is actually stuck". These are the stalls
 * the old spreadsheet couldn't surface — every one maps to a concrete next
 * action for the day.
 */
export async function getDashboardStalls(clientId: string): Promise<DashboardStalls> {
  const partnerships = await db
    .select({
      id: cmPartnerships.id,
      stage: cmPartnerships.stage,
      name: cmCreators.name,
      username: cmCreators.username,
    })
    .from(cmPartnerships)
    .innerJoin(cmCreators, eq(cmPartnerships.creatorId, cmCreators.id))
    .where(eq(cmCreators.clientId, clientId));

  const byId = new Map(partnerships.map((p) => [p.id, p]));

  // 1. Awaiting address — the biggest bottleneck in the current data.
  const awaitingAddress: StallItem[] = partnerships
    .filter((p) => p.stage === "awaiting_address")
    .map((p) => ({ partnershipId: p.id, name: p.name, username: p.username, detail: "Agreed — needs shipping address" }));

  // 2. Ready to ship but not shipped.
  const shipRows = await db
    .select({ shipmentId: cmShipments.id, partnershipId: cmShipments.partnershipId, status: cmShipments.status })
    .from(cmShipments)
    .innerJoin(cmPartnerships, eq(cmShipments.partnershipId, cmPartnerships.id))
    .innerJoin(cmCreators, eq(cmPartnerships.creatorId, cmCreators.id))
    .where(and(eq(cmCreators.clientId, clientId), eq(cmShipments.status, "ready")));
  const readyToShip: StallItem[] = shipRows
    .map((s) => {
      const p = byId.get(s.partnershipId);
      return p
        ? { partnershipId: p.id, name: p.name, username: p.username, detail: "Product ready — not shipped", shipmentId: s.shipmentId }
        : null;
    })
    .filter((p): p is NonNullable<typeof p> => !!p);

  // 3. Delivered but no video yet (fulfilment stages with a delivered shipment
  //    and zero deliverables).
  const deliveredShipments = await db
    .select({ partnershipId: cmShipments.partnershipId, status: cmShipments.status })
    .from(cmShipments)
    .innerJoin(cmPartnerships, eq(cmShipments.partnershipId, cmPartnerships.id))
    .innerJoin(cmCreators, eq(cmPartnerships.creatorId, cmCreators.id))
    .where(and(eq(cmCreators.clientId, clientId), inArray(cmShipments.status, ["shipped", "delivered"])));

  // One entry per partnership even if it has several shipments; "delivered"
  // wins over "shipped" for the label.
  const statusByPartnership = new Map<string, "shipped" | "delivered">();
  for (const s of deliveredShipments) {
    const cur = statusByPartnership.get(s.partnershipId);
    if (!cur || s.status === "delivered") statusByPartnership.set(s.partnershipId, s.status as "shipped" | "delivered");
  }
  const deliveredIds = [...statusByPartnership.keys()];
  const withDeliverables = deliveredIds.length
    ? new Set(
        (
          await db
            .selectDistinct({ partnershipId: cmDeliverables.partnershipId })
            .from(cmDeliverables)
            .where(inArray(cmDeliverables.partnershipId, deliveredIds))
        ).map((d) => d.partnershipId),
      )
    : new Set<string>();

  const deliveredNoVideo: StallItem[] = deliveredIds
    .filter((id) => !withDeliverables.has(id))
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({
      partnershipId: p.id,
      name: p.name,
      username: p.username,
      detail:
        statusByPartnership.get(p.id) === "delivered"
          ? "Product delivered — no video posted"
          : "Product shipped — no video yet",
    }));

  // 4. Follow-ups due — derived live from the outreach timeline so it matches
  //    what the cron would flag, without needing the cron to have run.
  const contactableIds = partnerships
    .filter((p) => ["contacted", "shortlisted"].includes(p.stage))
    .map((p) => p.id);
  const [states, t] = await Promise.all([
    getOutreachStates(contactableIds),
    getFollowUpThresholds(clientId),
  ]);
  const contactable = new Set(contactableIds);
  const followUpsDue: StallItem[] = [];
  for (const p of partnerships) {
    if (!contactable.has(p.id)) continue;
    const st = states.get(p.id);
    if (!st || st.hasReplied) continue;
    const days = st.daysSinceLastOutbound;
    if (p.stage === "shortlisted" && st.totalOutbound === 0) {
      followUpsDue.push({ partnershipId: p.id, name: p.name, username: p.username, detail: "Shortlisted — send initial outreach", kind: "initial" });
    } else if (st.datesAreMigrated) {
      // Imported sheet rows carry no real contact date. Surface them honestly
      // for a human check instead of inventing a "No reply in Nd" clock.
      followUpsDue.push({ partnershipId: p.id, name: p.name, username: p.username, detail: "Imported — last contact date unknown, confirm status", kind: "follow_up", migrated: true });
    } else if (days != null) {
      if (st.followUpCount === 0 && days >= t.followUp1AfterDays) {
        followUpsDue.push({ partnershipId: p.id, name: p.name, username: p.username, detail: `No reply in ${days}d — follow-up 1 due`, kind: "follow_up" });
      } else if (st.followUpCount === 1 && days >= t.followUp2AfterDays) {
        followUpsDue.push({ partnershipId: p.id, name: p.name, username: p.username, detail: `No reply in ${days}d — follow-up 2 due`, kind: "follow_up" });
      }
    }
  }

  return { followUpsDue, awaitingAddress, readyToShip, deliveredNoVideo };
}
