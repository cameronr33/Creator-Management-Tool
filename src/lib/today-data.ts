import { desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmPartnerships, cmShipments, type CmStage } from "@/lib/db/schema";
import { getCreatorRows, getFollowUpThresholds, getOutreachStates } from "@/lib/queries";
import { deriveOutreachState } from "@/lib/outreach";
import { hasCompleteAddress } from "@/lib/address";
import { placeOnToday, type TodaySection } from "@/lib/today";
import type { WhoseTurn } from "@/lib/activity";

/** One Today row — plain values only, so it can go straight to the client list. */
export interface TodayRow {
  partnershipId: string;
  name: string;
  username: string;
  campaignName: string;
  stage: CmStage;
  section: TodaySection;
  note: string | null;
  latest: string;
  latestFromEmail: boolean;
  latestAt: string | null;
  whoseTurn: WhoseTurn | null;
  soundsLikeNo: boolean;
  hasOutbound: boolean;
  suggestedAddress: string | null;
  shipmentId: string | null;
}

export interface TodayData {
  rows: TodayRow[];
  /** Live creators per stage, for the A-to-Z strip. */
  stageCounts: Partial<Record<CmStage, number>>;
}

export async function getTodayData(clientId: string, campaignId?: string): Promise<TodayData> {
  const creators = await getCreatorRows(clientId, { campaignId, withOutreach: false });
  const stageCounts: Partial<Record<CmStage, number>> = {};
  for (const c of creators) stageCounts[c.stage] = (stageCounts[c.stage] ?? 0) + 1;
  if (creators.length === 0) return { rows: [], stageCounts };

  const ids = creators.map((c) => c.partnershipId);
  const [outreach, thresholds, details, shipments] = await Promise.all([
    getOutreachStates(ids),
    getFollowUpThresholds(clientId),
    db
      .select({
        id: cmPartnerships.id,
        addressLine1: cmPartnerships.addressLine1,
        city: cmPartnerships.city,
        region: cmPartnerships.region,
        postalCode: cmPartnerships.postalCode,
        suggestedAddress: cmPartnerships.suggestedAddress,
      })
      .from(cmPartnerships)
      .where(inArray(cmPartnerships.id, ids)),
    db
      .select({ id: cmShipments.id, partnershipId: cmShipments.partnershipId })
      .from(cmShipments)
      .where(inArray(cmShipments.partnershipId, ids))
      .orderBy(desc(cmShipments.createdAt)),
  ]);
  const detailById = new Map(details.map((d) => [d.id, d]));
  const latestShipment = new Map<string, string>();
  for (const s of shipments) if (!latestShipment.has(s.partnershipId)) latestShipment.set(s.partnershipId, s.id);

  const rows: TodayRow[] = [];
  for (const c of creators) {
    const o = outreach.get(c.partnershipId) ?? deriveOutreachState([]);
    const placed = placeOnToday({
      stage: c.stage,
      whoseTurn: c.activity.whoseTurn,
      lastOutboundAt: o.lastOutboundAt,
      followUpCount: o.followUpCount,
      datesAreMigrated: o.datesAreMigrated,
      thresholds,
    });
    if (!placed) continue;
    const d = detailById.get(c.partnershipId);
    rows.push({
      partnershipId: c.partnershipId,
      name: c.name,
      username: c.username,
      campaignName: c.campaignName,
      stage: c.stage,
      section: placed.section,
      note: placed.note,
      latest: c.activity.text,
      latestFromEmail: c.activity.fromEmail,
      latestAt: c.activity.at?.toISOString() ?? null,
      whoseTurn: c.activity.whoseTurn,
      soundsLikeNo: c.emailSoundsLikeNo,
      hasOutbound: o.totalOutbound > 0,
      suggestedAddress: d && !hasCompleteAddress(d) ? d.suggestedAddress : null,
      shipmentId: latestShipment.get(c.partnershipId) ?? null,
    });
  }
  return { rows, stageCounts };
}
