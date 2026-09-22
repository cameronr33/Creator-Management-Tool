import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmCreators, cmCampaigns, cmPartnerships, cmShipments, cmDeliverables } from "@/lib/db/schema";
import { getOutreachStates, getFollowUpThresholds } from "@/lib/queries";
import { deriveOutreachState } from "@/lib/outreach";
import { deriveWorkspaceItem } from "@/lib/workspace";
import { canonicalStage } from "@/lib/stages";

/** One row per partnership; package records never multiply the daily worklist. */
export async function getWorkspaceItems(clientId: string) {
  const rows = await db.select({
    partnershipId: cmPartnerships.id, creatorId: cmCreators.id,
    name: cmCreators.name, username: cmCreators.username, profileUrl: cmCreators.profileUrl,
    contentPillar: cmCreators.contentPillar, followers: cmCreators.followers, avgViews: cmCreators.avgViews,
    viewsSource: cmCreators.viewsSource, businessEmail: cmCreators.businessEmail,
    campaignId: cmCampaigns.id, campaignName: cmCampaigns.name, stage: cmPartnerships.stage,
    agreementType: cmPartnerships.agreementType, addressLine1: cmPartnerships.addressLine1,
    city: cmPartnerships.city, region: cmPartnerships.region, postalCode: cmPartnerships.postalCode,
    briefUrl: cmPartnerships.briefUrl, briefSentAt: cmPartnerships.briefSentAt, exitReason: cmPartnerships.exitReason,
  }).from(cmPartnerships)
    .innerJoin(cmCreators, eq(cmCreators.id, cmPartnerships.creatorId))
    .innerJoin(cmCampaigns, eq(cmCampaigns.id, cmPartnerships.campaignId))
    .where(eq(cmCreators.clientId, clientId));
  if (!rows.length) return [];
  const ids = rows.map(r => r.partnershipId);
  const [outreach, thresholds, shipments, posts] = await Promise.all([
    getOutreachStates(ids), getFollowUpThresholds(clientId),
    db.select({ partnershipId: cmShipments.partnershipId, status: cmShipments.status }).from(cmShipments).where(inArray(cmShipments.partnershipId, ids)),
    db.select({ partnershipId: cmDeliverables.partnershipId }).from(cmDeliverables).where(inArray(cmDeliverables.partnershipId, ids)),
  ]);
  return rows.map(r => deriveWorkspaceItem({
    ...r, stage: canonicalStage(r.stage), hasAddress: !!(r.addressLine1?.trim() && r.city?.trim() && r.region?.trim() && r.postalCode?.trim()),
    hasBrief: !!r.briefUrl, briefSent: !!r.briefSentAt,
    shipments: shipments.filter(s => s.partnershipId === r.partnershipId),
    deliverables: posts.filter(p => p.partnershipId === r.partnershipId).length,
    outreach: outreach.get(r.partnershipId) ?? deriveOutreachState([]), thresholds,
  }));
}
