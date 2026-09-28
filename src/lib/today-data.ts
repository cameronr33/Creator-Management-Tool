import { desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmPartnerships, cmShipments, type CmStage } from "@/lib/db/schema";
import { getCreatorRows, getFollowUpThresholds, getOutreachStates } from "@/lib/queries";
import { deriveOutreachState } from "@/lib/outreach";
import { hasCompleteAddress } from "@/lib/address";
import { placeOnToday, type TodaySection } from "@/lib/today";
import type { WhoseTurn } from "@/lib/activity";
import { statusNoteView, type StatusNoteView } from "@/lib/status-note";
import { hiddenSummary, splitByView, type View } from "@/lib/owners";

/** One Today row — plain values only, so it can go straight to the client list. */
export interface TodayRow {
  partnershipId: string;
  name: string;
  /** Null for a creator added by name alone (no profile link). */
  username: string | null;
  campaignName: string;
  stage: CmStage;
  section: TodaySection;
  note: string | null;
  latest: string;
  latestFromEmail: boolean;
  latestAt: string | null;
  whoseTurn: WhoseTurn | null;
  /** Our own note, with who wrote it and when (ISO). */
  statusNote: StatusNoteView | null;
  soundsLikeNo: boolean;
  hasOutbound: boolean;
  suggestedAddress: string | null;
  shipmentId: string | null;
  photoUrl: string | null;
  clientApproval: "pending" | "approved" | "passed" | null;
  approvalByName: string | null;
  /** Who looks after it; null = unassigned. */
  ownerId: string | null;
  ownerName: string | null;
}

export interface TodayData {
  rows: TodayRow[];
  /** Live creators per stage on this view, for the A-to-Z strip. */
  stageCounts: Partial<Record<CmStage, number>>;
  /** On Mine: how many deals (and whose) aren't shown — "7 of Kieran's not shown". */
  hiddenSummary: string | null;
  /** Creators on the client/campaign at all, whatever the view — tells "all caught up" from "none yet". */
  totalCreators: number;
}

export interface TodayOptions {
  clientId: string;
  campaignId?: string;
  view?: View;
  userId?: string | null;
}

export async function getTodayData({ clientId, campaignId, view = "all", userId }: TodayOptions): Promise<TodayData> {
  const all = await getCreatorRows(clientId, { campaignId, withOutreach: false });
  const { shown: creators, hidden } = splitByView(all, view, userId);
  const stageCounts: Partial<Record<CmStage, number>> = {};
  for (const c of creators) stageCounts[c.stage] = (stageCounts[c.stage] ?? 0) + 1;
  const base = { stageCounts, hiddenSummary: hiddenSummary(hidden), totalCreators: all.length };
  if (creators.length === 0) return { rows: [], ...base };

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
      clientApproval: c.clientApproval,
    });
    if (!placed) continue;
    const d = detailById.get(c.partnershipId);
    rows.push({
      partnershipId: c.partnershipId,
      name: c.name,
      username: c.profileUrl ? c.username : null,
      campaignName: c.campaignName,
      stage: c.stage,
      section: placed.section,
      note: placed.note,
      latest: c.activity.text,
      latestFromEmail: c.activity.fromEmail,
      latestAt: c.activity.at?.toISOString() ?? null,
      whoseTurn: c.activity.whoseTurn,
      statusNote: statusNoteView(c),
      soundsLikeNo: c.emailSoundsLikeNo,
      hasOutbound: o.totalOutbound > 0,
      suggestedAddress: d && !hasCompleteAddress(d) ? d.suggestedAddress : null,
      shipmentId: latestShipment.get(c.partnershipId) ?? null,
      photoUrl: c.photoUrl,
      clientApproval: c.clientApproval,
      approvalByName: c.approvalByName,
      ownerId: c.ownerId,
      ownerName: c.ownerName,
    });
  }
  return { rows, ...base };
}
