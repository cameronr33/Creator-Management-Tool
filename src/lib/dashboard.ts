import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cmCreators,
  cmPartnerships,
  cmShipments,
  cmDeliverables,
} from "@/lib/db/schema";
import { getOutreachStates } from "@/lib/queries";
import { DEFAULT_THRESHOLDS } from "@/lib/outreach";

export interface StallItem {
  partnershipId: string;
  name: string;
  username: string;
  detail: string;
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
    .select({ partnershipId: cmShipments.partnershipId, status: cmShipments.status })
    .from(cmShipments)
    .innerJoin(cmPartnerships, eq(cmShipments.partnershipId, cmPartnerships.id))
    .innerJoin(cmCreators, eq(cmPartnerships.creatorId, cmCreators.id))
    .where(and(eq(cmCreators.clientId, clientId), eq(cmShipments.status, "ready")));
  const readyToShip: StallItem[] = shipRows
    .map((s) => byId.get(s.partnershipId))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ partnershipId: p.id, name: p.name, username: p.username, detail: "Product ready — not shipped" }));

  // 3. Delivered but no video yet (fulfilment stages with a delivered shipment
  //    and zero deliverables).
  const deliveredShipments = await db
    .select({ partnershipId: cmShipments.partnershipId })
    .from(cmShipments)
    .innerJoin(cmPartnerships, eq(cmShipments.partnershipId, cmPartnerships.id))
    .innerJoin(cmCreators, eq(cmPartnerships.creatorId, cmCreators.id))
    .where(and(eq(cmCreators.clientId, clientId), inArray(cmShipments.status, ["shipped", "delivered"])));

  const deliveredIds = deliveredShipments.map((d) => d.partnershipId);
  const withDeliverables = deliveredIds.length
    ? new Set(
        (
          await db
            .select({ partnershipId: cmDeliverables.partnershipId })
            .from(cmDeliverables)
            .where(inArray(cmDeliverables.partnershipId, deliveredIds))
        ).map((d) => d.partnershipId),
      )
    : new Set<string>();

  const deliveredNoVideo: StallItem[] = deliveredIds
    .filter((id) => !withDeliverables.has(id))
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ partnershipId: p.id, name: p.name, username: p.username, detail: "Product delivered — no video posted" }));

  // 4. Follow-ups due — derived live from the outreach timeline so it matches
  //    what the cron would flag, without needing the cron to have run.
  const contactableIds = partnerships
    .filter((p) => ["contacted", "shortlisted"].includes(p.stage))
    .map((p) => p.id);
  const states = await getOutreachStates(contactableIds);
  const followUpsDue: StallItem[] = [];
  for (const p of partnerships) {
    if (!contactableIds.includes(p.id)) continue;
    const st = states.get(p.id);
    if (!st || st.hasReplied) continue;
    const days = st.daysSinceLastOutbound;
    if (p.stage === "shortlisted" && st.totalOutbound === 0) {
      followUpsDue.push({ partnershipId: p.id, name: p.name, username: p.username, detail: "Shortlisted — send initial outreach" });
    } else if (days != null) {
      const t = DEFAULT_THRESHOLDS;
      if (st.followUpCount === 0 && days >= t.followUp1AfterDays) {
        followUpsDue.push({ partnershipId: p.id, name: p.name, username: p.username, detail: `No reply in ${days}d — follow-up 1 due` });
      } else if (st.followUpCount === 1 && days >= t.followUp2AfterDays) {
        followUpsDue.push({ partnershipId: p.id, name: p.name, username: p.username, detail: `No reply in ${days}d — follow-up 2 due` });
      }
    }
  }

  return { followUpsDue, awaitingAddress, readyToShip, deliveredNoVideo };
}
