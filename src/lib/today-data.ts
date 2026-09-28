import { desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmPartnerships, cmShipments, type CmStage } from "@/lib/db/schema";
import { getCreatorRows, getFollowUpThresholds, getOutreachStates, getStageSince } from "@/lib/queries";
import { deriveOutreachState } from "@/lib/outreach";
import { hasCompleteAddress } from "@/lib/address";
import { placeOnToday, sortToday, type TodaySection } from "@/lib/today";
import type { WhoseTurn } from "@/lib/activity";
import { statusNoteView, type StatusNoteView } from "@/lib/status-note";
import { hiddenSummary, splitByView, type View } from "@/lib/owners";
import { snoozeActive } from "@/lib/snooze-rules";
import { getLastInboundStoredAt } from "@/lib/snooze";

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
  /** Waiting since (ISO) — the order within a section; null = unknown. */
  since: string | null;
  /** "due" (first message) or "late" (video). */
  badge: "due" | "late" | null;
  /** While snoozed: back when (ISO), who snoozed it and why. */
  snooze: { until: string; by: string | null; reason: string | null } | null;
}

export interface TodayData {
  rows: TodayRow[];
  /** Live creators per stage on this view, for the A-to-Z strip. */
  stageCounts: Partial<Record<CmStage, number>>;
  /** On Mine: how many deals (and whose) aren't shown — "7 of Kieran's not shown". */
  hiddenSummary: string | null;
  /** Creators on the client/campaign at all, whatever the view — tells "all caught up" from "none yet". */
  totalCreators: number;
  /** How many are snoozed off Today right now. */
  snoozedCount: number;
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
  if (creators.length === 0) return { rows: [], ...base, snoozedCount: 0 };

  const ids = creators.map((c) => c.partnershipId);
  const [outreach, thresholds, details, shipments, stageSince, lastInbound] = await Promise.all([
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
      .select({ id: cmShipments.id, partnershipId: cmShipments.partnershipId, shippedAt: cmShipments.shippedAt, deliveredAt: cmShipments.deliveredAt })
      .from(cmShipments)
      .where(inArray(cmShipments.partnershipId, ids))
      .orderBy(desc(cmShipments.createdAt)),
    getStageSince(ids),
    getLastInboundStoredAt(ids),
  ]);
  const detailById = new Map(details.map((d) => [d.id, d]));
  const latestShipment = new Map<string, (typeof shipments)[number]>();
  for (const s of shipments) if (!latestShipment.has(s.partnershipId)) latestShipment.set(s.partnershipId, s);

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
      lastFrom: c.activity.lastFrom,
      lastMessageAt: c.activity.at,
      stageSince: stageSince.get(c.partnershipId) ?? c.createdAt,
      approvalAt: c.approvalAt,
      shippedAt: latestShipment.get(c.partnershipId)?.shippedAt ?? null,
      deliveredAt: latestShipment.get(c.partnershipId)?.deliveredAt ?? null,
    });
    if (!placed) continue;
    // Snoozed: off the working sections until the date, or until they write or the stage moves.
    const asleep = snoozeActive({ ...c, stage: c.stage, lastInboundStoredAt: lastInbound.get(c.partnershipId) ?? null });
    const d = detailById.get(c.partnershipId);
    rows.push({
      partnershipId: c.partnershipId,
      name: c.name,
      username: c.profileUrl ? c.username : null,
      campaignName: c.campaignName,
      stage: c.stage,
      section: asleep ? "snoozed" : placed.section,
      note: asleep ? null : placed.note,
      latest: c.activity.text,
      latestFromEmail: c.activity.fromEmail,
      latestAt: c.activity.at?.toISOString() ?? null,
      whoseTurn: c.activity.whoseTurn,
      statusNote: statusNoteView(c),
      soundsLikeNo: c.emailSoundsLikeNo,
      hasOutbound: o.totalOutbound > 0,
      suggestedAddress: d && !hasCompleteAddress(d) ? d.suggestedAddress : null,
      shipmentId: latestShipment.get(c.partnershipId)?.id ?? null,
      photoUrl: c.photoUrl,
      clientApproval: c.clientApproval,
      approvalByName: c.approvalByName,
      ownerId: c.ownerId,
      ownerName: c.ownerName,
      since: asleep ? c.snoozedUntil!.toISOString() : (placed.since?.toISOString() ?? null),
      badge: asleep ? null : placed.badge,
      snooze: asleep ? { until: c.snoozedUntil!.toISOString(), by: c.snoozedByName, reason: c.snoozeReason } : null,
    });
  }
  return { rows: sortToday(rows), ...base, snoozedCount: rows.filter((r) => r.section === "snoozed").length };
}
