import { desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmPartnerships, cmShipments, type CmStage } from "@/lib/db/schema";
import { getCreatorRows, getFollowUpThresholds, getOutreachStates, getStageSince } from "@/lib/queries";
import { deriveOutreachState } from "@/lib/outreach";
import { hasCompleteAddress } from "@/lib/address";
import { listedOnToday, placeOnToday, sortToday, type TodaySection } from "@/lib/today";
import type { WhoseTurn } from "@/lib/activity";
import { statusNoteView, type StatusNoteView } from "@/lib/status-note";
import { hiddenSummary, splitByView, type MemberId, type View } from "@/lib/owners";
import { archiveWoke, splitArchived } from "@/lib/archive-rules";
import { staleStage } from "@/lib/stage-flag";
import { lastStageDecisionAt } from "@/lib/email-ingest";
import { getLastInboundStoredAt } from "@/lib/archive";

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
  /** Their emails read as an earlier stage (stage-flag.ts): what to suggest, and the line behind it. */
  /** Their emails read as an earlier stage; `beneath` is where the row would sit otherwise, so its own next step still shows. */
  stageFlag: { suggested: CmStage; quote: string | null; beneath: TodaySection | null } | null;
  /** Back from the archive: because the reminder date came or they wrote, with who archived it and why. */
  backFromArchive: { why: "reminder" | "wrote"; by: string | null; reason: string | null } | null;
}

export interface TodayData {
  rows: TodayRow[];
  /** Live creators per stage on this view, for the A-to-Z strip. */
  stageCounts: Partial<Record<CmStage, number>>;
  /** On Mine: how many deals (and whose) aren't shown — "7 of Kieran's not shown". */
  hiddenSummary: string | null;
  /** Creators on the client/campaign at all, whatever the view — tells "all caught up" from "none yet". */
  totalCreators: number;
  /** How many on this view are archived (not listed anywhere but Creators → Archived). */
  archivedCount: number;
}

export interface TodayOptions {
  clientId: string;
  campaignId?: string;
  view?: View;
  /** My team member (owners.ts memberForUser) — never a login id. */
  me?: MemberId | null;
}

export async function getTodayData({ clientId, campaignId, view = "all", me }: TodayOptions): Promise<TodayData> {
  const everything = await getCreatorRows(clientId, { campaignId, withOutreach: false });
  // Archived creators are off Today — and out of every count here — before Mine splits anything (2026-09-29).
  const lastInbound = await getLastInboundStoredAt(everything.map((c) => c.partnershipId));
  const { active: all, archived } = splitArchived(everything, lastInbound);
  const archivedCount = splitByView(archived, view, me).shown.length;
  const { shown: creators, hidden } = splitByView(all, view, me);
  const stageCounts: Partial<Record<CmStage, number>> = {};
  for (const c of creators) stageCounts[c.stage] = (stageCounts[c.stage] ?? 0) + 1;
  // "N of Kieran's not shown" counts only what Today would have listed — never their Posted or closed deals.
  const base = { stageCounts, hiddenSummary: hiddenSummary(hidden.filter((h) => listedOnToday(h.stage))), totalCreators: everything.length, archivedCount };
  if (creators.length === 0) return { rows: [], ...base };

  const ids = creators.map((c) => c.partnershipId);
  const [outreach, thresholds, details, shipments, stageSince, decided] = await Promise.all([
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
    lastStageDecisionAt(ids),
  ]);
  const detailById = new Map(details.map((d) => [d.id, d]));
  const latestShipment = new Map<string, (typeof shipments)[number]>();
  for (const s of shipments) if (!latestShipment.has(s.partnershipId)) latestShipment.set(s.partnershipId, s);

  const rows: TodayRow[] = [];
  for (const c of creators) {
    const o = outreach.get(c.partnershipId) ?? deriveOutreachState([]);
    const suggested = staleStage({
      stage: c.stage,
      emailStage: c.emailStage,
      emailStageAt: c.emailStageAt,
      decidedAt: decided.get(c.partnershipId) ?? null,
      hasShipment: latestShipment.has(c.partnershipId),
      dismissedAt: c.stageFlagDismissedAt,
    });
    const facts = {
      staleStageAt: c.emailStageAt,
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
    };
    const placed = placeOnToday({ ...facts, staleStage: suggested });
    if (!placed) continue;
    const beneath = suggested ? (placeOnToday({ ...facts, staleStage: null })?.section ?? null) : null;
    const woke = archiveWoke({ ...c, lastInboundStoredAt: lastInbound.get(c.partnershipId) ?? null });
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
      shipmentId: latestShipment.get(c.partnershipId)?.id ?? null,
      photoUrl: c.photoUrl,
      clientApproval: c.clientApproval,
      approvalByName: c.approvalByName,
      ownerId: c.ownerId,
      ownerName: c.ownerName,
      since: placed.since?.toISOString() ?? null,
      badge: placed.badge,
      backFromArchive: woke ? { why: woke, by: c.archivedByName, reason: c.archiveReason } : null,
      stageFlag: suggested ? { suggested, quote: c.emailStageQuote, beneath } : null,
    });
  }
  return { rows: sortToday(rows), ...base };
}
