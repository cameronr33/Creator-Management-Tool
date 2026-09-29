import { cache } from "react";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  clients,
  cmCampaigns,
  cmCreatorPhotos,
  cmCreators,
  cmPartnerships,
  cmOutreachEvents,
  cmShipments,
  cmDeliverables,
  cmProductsRequested,
  cmCreatorSocials,
  cmClientSettings,
  cmTeamMembers,
  cmStageTransitions,
  type CmStage,
} from "@/lib/db/schema";
import { canonicalStage } from "@/lib/stages";
import { latestActivity, type Activity, type LastMessage } from "@/lib/activity";
import {
  deriveOutreachState,
  daysBetween,
  DEFAULT_THRESHOLDS,
  type OutreachState,
  type FollowUpThresholds,
} from "@/lib/outreach";

export type ActiveClient = { id: string; name: string; slug: string };

/**
 * Clients this tool shows: active in the shared roster and not hidden here.
 * Wrapped in React `cache()` so the layout, page and every helper that calls
 * resolveClient() share ONE query per request instead of 3–4 (Neon HTTP
 * makes each one a round trip).
 */
export const getClients = cache(async (): Promise<ActiveClient[]> => {
  const rows = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug, hidden: cmClientSettings.hidden })
    .from(clients)
    .leftJoin(cmClientSettings, eq(cmClientSettings.clientId, clients.id))
    .where(eq(clients.isActive, true))
    .orderBy(clients.name);
  return rows.filter((r) => !r.hidden).map((r) => ({ id: r.id, name: r.name, slug: r.slug }));
});

export interface ClientWithSettings extends ActiveClient {
  hidden: boolean;
  followUpThresholds: Partial<FollowUpThresholds> | null;
  requiresApproval: boolean;
}

/** Every active client in the shared roster with this app's per-client knobs. */
export async function getClientsWithSettings(): Promise<ClientWithSettings[]> {
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      hidden: cmClientSettings.hidden,
      followUpThresholds: cmClientSettings.followUpThresholds,
      requiresApproval: cmClientSettings.requiresApproval,
    })
    .from(clients)
    .leftJoin(cmClientSettings, eq(cmClientSettings.clientId, clients.id))
    .where(eq(clients.isActive, true))
    .orderBy(clients.name);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    hidden: r.hidden ?? false,
    followUpThresholds: (r.followUpThresholds as Partial<FollowUpThresholds> | null) ?? null,
    requiresApproval: r.requiresApproval ?? false,
  }));
}

/**
 * Follow-up cadence for a set of clients: per-client overrides merged over
 * DEFAULT_THRESHOLDS. The reference the follow-up loop controls toward now
 * has an owner (Settings) instead of being a hardcoded number.
 */
export async function getFollowUpThresholdsByClient(
  clientIds: string[],
): Promise<Map<string, FollowUpThresholds>> {
  const map = new Map<string, FollowUpThresholds>();
  if (clientIds.length === 0) return map;
  const rows = await db
    .select({ clientId: cmClientSettings.clientId, t: cmClientSettings.followUpThresholds })
    .from(cmClientSettings)
    .where(inArray(cmClientSettings.clientId, clientIds));
  for (const id of clientIds) map.set(id, DEFAULT_THRESHOLDS);
  for (const r of rows) {
    map.set(r.clientId, { ...DEFAULT_THRESHOLDS, ...((r.t as Partial<FollowUpThresholds> | null) ?? {}) });
  }
  return map;
}

export async function getFollowUpThresholds(clientId: string): Promise<FollowUpThresholds> {
  return (await getFollowUpThresholdsByClient([clientId])).get(clientId) ?? DEFAULT_THRESHOLDS;
}

/** Resolve the active client from a slug, falling back to the first client. */
export async function resolveClient(slug: string | null | undefined): Promise<ActiveClient | null> {
  const all = await getClients();
  if (all.length === 0) return null;
  if (slug) {
    const match = all.find((c) => c.slug === slug);
    if (match) return match;
  }
  return all[0];
}

export async function getCampaigns(clientId: string) {
  return db
    .select()
    .from(cmCampaigns)
    .where(eq(cmCampaigns.clientId, clientId))
    .orderBy(cmCampaigns.name);
}

/** A partnership joined with its creator + campaign — the row the grid renders. */
export interface CreatorRow {
  partnershipId: string;
  creatorId: string;
  name: string;
  username: string;
  profileUrl: string;
  contentPillar: string | null;
  followers: number | null;
  avgViews: number | null;
  maxViews: number | null;
  cadencePerWeek: string | null;
  viewsSource: string | null;
  businessEmail: string | null;
  stage: CmStage;
  agreementType: string | null;
  campaignId: string;
  campaignName: string;
  feeAmount: string | null;
  outreachReason: string | null;
  emailSummary: string | null;
  emailSummaryAt: Date | null;
  emailWhoseTurn: string | null;
  emailSoundsLikeNo: boolean;
  replyHandledAt: Date | null;
  /** When the deal was created, and when the client approved it (for "waiting since" on Today). */
  createdAt: Date;
  approvalAt: Date | null;
  /** Who looks after the deal (null = unassigned) and their name. */
  ownerId: string | null;
  ownerName: string | null;
  /** Snoozed off Today (see snooze-rules.ts). */
  snoozedUntil: Date | null;
  snoozedAt: Date | null;
  snoozeStage: CmStage | null;
  snoozeReason: string | null;
  snoozedByName: string | null;
  /** Our own note on where things stand, with who wrote it and when. */
  statusNote: string | null;
  statusNoteAt: Date | null;
  statusNoteBy: string | null;
  /** The client's say before outreach: pending / approved / passed, or null when not needed. */
  clientApproval: "pending" | "approved" | "passed" | null;
  approvalByName: string | null;
  /** The last real message and whose move it is — every card and row shows this. */
  activity: Activity;
  /** The app's URL for their stored profile picture, or null. */
  photoUrl: string | null;
  lastOutboundAt: Date | null;
  repliedAt: Date | null;
  followUpCount: number;
}

export async function getCreatorRows(
  clientId: string,
  opts?: {
    campaignId?: string;
    stage?: CmStage;
    /** Only the grid and worklist render outreach state; the board and campaigns don't pay for it. */
    withOutreach?: boolean;
  },
): Promise<CreatorRow[]> {
  const conds = [eq(cmCreators.clientId, clientId)];
  if (opts?.campaignId) conds.push(eq(cmPartnerships.campaignId, opts.campaignId));
  if (opts?.stage) conds.push(eq(cmPartnerships.stage, opts.stage));

  const rows = await db
    .select({
      partnershipId: cmPartnerships.id,
      creatorId: cmCreators.id,
      name: cmCreators.name,
      username: cmCreators.username,
      profileUrl: cmCreators.profileUrl,
      contentPillar: cmCreators.contentPillar,
      followers: cmCreators.followers,
      avgViews: cmCreators.avgViews,
      maxViews: cmCreators.maxViews,
      cadencePerWeek: cmCreators.cadencePerWeek,
      viewsSource: cmCreators.viewsSource,
      businessEmail: cmCreators.businessEmail,
      stage: cmPartnerships.stage,
      agreementType: cmPartnerships.agreementType,
      campaignId: cmPartnerships.campaignId,
      campaignName: cmCampaigns.name,
      feeAmount: cmPartnerships.feeAmount,
      outreachReason: cmPartnerships.outreachReason,
      emailSummary: cmPartnerships.emailSummary,
      emailSummaryAt: cmPartnerships.emailSummaryAt,
      emailWhoseTurn: cmPartnerships.emailWhoseTurn,
      emailSoundsLikeNo: cmPartnerships.emailSoundsLikeNo,
      replyHandledAt: cmPartnerships.replyHandledAt,
      statusNote: cmPartnerships.statusNote,
      statusNoteAt: cmPartnerships.statusNoteAt,
      statusNoteBy: cmPartnerships.statusNoteBy,
      ownerId: cmPartnerships.ownerId,
      ownerName: cmTeamMembers.name,
      createdAt: cmPartnerships.createdAt,
      approvalAt: cmPartnerships.approvalAt,
      snoozedUntil: cmPartnerships.snoozedUntil,
      snoozedAt: cmPartnerships.snoozedAt,
      snoozeStage: cmPartnerships.snoozeStage,
      snoozeReason: cmPartnerships.snoozeReason,
      snoozedByName: cmPartnerships.snoozedByName,
      clientApproval: cmPartnerships.clientApproval,
      approvalByName: cmPartnerships.approvalByName,
      photoFetchedAt: cmCreatorPhotos.fetchedAt,
    })
    .from(cmPartnerships)
    .innerJoin(cmCreators, eq(cmPartnerships.creatorId, cmCreators.id))
    .innerJoin(cmCampaigns, eq(cmPartnerships.campaignId, cmCampaigns.id))
    .leftJoin(cmCreatorPhotos, eq(cmCreatorPhotos.creatorId, cmCreators.id))
    .leftJoin(cmTeamMembers, eq(cmTeamMembers.id, cmPartnerships.ownerId))
    .where(and(...conds))
    .orderBy(desc(cmCreators.followers));

  if (rows.length === 0) return [];
  // A retired stage value can only appear in the window before stages:migrate
  // runs; show it as the stage it now means rather than dropping the row.
  for (const r of rows) r.stage = canonicalStage(r.stage);
  const partnershipIds = rows.map((r) => r.partnershipId);
  const [lastMessages, outreachByPartnership] = await Promise.all([
    getLastMessages(partnershipIds),
    opts?.withOutreach === false ? Promise.resolve(new Map<string, OutreachState>()) : getOutreachStates(partnershipIds),
  ]);

  return rows.map(({ photoFetchedAt, ...r }) => {
    const st = outreachByPartnership.get(r.partnershipId);
    return {
      ...r,
      photoUrl: photoUrl(r.creatorId, photoFetchedAt),
      activity: latestActivity({
        last: lastMessages.get(r.partnershipId) ?? null,
        emailSummary: r.emailSummary,
        emailSummaryAt: r.emailSummaryAt,
        emailWhoseTurn: r.emailWhoseTurn,
        replyHandledAt: r.replyHandledAt,
      }),
      lastOutboundAt: st?.lastOutboundAt ?? null,
      repliedAt: st?.repliedAt ?? null,
      followUpCount: st?.followUpCount ?? 0,
    };
  });
}

/** The app's URL for a stored picture; the ?v= changes when it's re-fetched, so browsers can cache each one for good. */
export function photoUrl(creatorId: string, fetchedAt: Date | null | undefined): string | null {
  return fetchedAt ? `/api/creators/${creatorId}/photo?v=${fetchedAt.getTime()}` : null;
}

/** One creator's picture URL, or null. */
export async function getPhotoUrl(creatorId: string): Promise<string | null> {
  const [p] = await db.select({ at: cmCreatorPhotos.fetchedAt }).from(cmCreatorPhotos).where(eq(cmCreatorPhotos.creatorId, creatorId)).limit(1);
  return photoUrl(creatorId, p?.at);
}

/** The latest real message (never a note) per partnership, in one query. */
export async function getLastMessages(partnershipIds: string[]): Promise<Map<string, LastMessage>> {
  const out = new Map<string, LastMessage>();
  if (partnershipIds.length === 0) return out;
  const rows = await db
    .selectDistinctOn([cmOutreachEvents.partnershipId], {
      partnershipId: cmOutreachEvents.partnershipId,
      at: cmOutreachEvents.occurredAt,
      direction: cmOutreachEvents.direction,
      channel: cmOutreachEvents.channel,
      senderRole: cmOutreachEvents.senderRole,
      subject: cmOutreachEvents.subject,
      isMigrated: cmOutreachEvents.isMigrated,
    })
    .from(cmOutreachEvents)
    .where(and(inArray(cmOutreachEvents.partnershipId, partnershipIds), ne(cmOutreachEvents.kind, "note")))
    // Same instant (imported rows): their reply counts as the later one (enum order: outbound, inbound).
    .orderBy(cmOutreachEvents.partnershipId, desc(cmOutreachEvents.occurredAt), desc(cmOutreachEvents.direction));
  for (const { partnershipId, ...m } of rows) out.set(partnershipId, m);
  return out;
}

/**
 * Outreach state for many partnerships in ONE aggregate query — one row per
 * partnership instead of every event ever logged. Must stay equivalent to
 * the pure deriveOutreachState() used on the detail page (verified in
 * scripts/verify-outreach-flow.ts).
 */
export async function getOutreachStates(
  partnershipIds: string[],
  now: Date = new Date(),
): Promise<Map<string, OutreachState>> {
  const map = new Map<string, OutreachState>();
  if (partnershipIds.length === 0) return map;

  const rows = await db
    .select({
      partnershipId: cmOutreachEvents.partnershipId,
      totalOutbound: sql<number>`count(*) filter (where ${cmOutreachEvents.direction} = 'outbound')::int`,
      followUpCount: sql<number>`count(*) filter (where ${cmOutreachEvents.direction} = 'outbound' and ${cmOutreachEvents.kind} = 'follow_up')::int`,
      firstContactAt: sql<Date | null>`min(${cmOutreachEvents.occurredAt}) filter (where ${cmOutreachEvents.direction} = 'outbound')`,
      lastOutboundAt: sql<Date | null>`max(${cmOutreachEvents.occurredAt}) filter (where ${cmOutreachEvents.direction} = 'outbound')`,
      lastContactAt: sql<Date | null>`max(${cmOutreachEvents.occurredAt})`,
      repliedAt: sql<Date | null>`min(${cmOutreachEvents.occurredAt}) filter (where ${cmOutreachEvents.direction} = 'inbound')`,
      allOutboundMigrated: sql<boolean | null>`bool_and(${cmOutreachEvents.isMigrated}) filter (where ${cmOutreachEvents.direction} = 'outbound')`,
    })
    .from(cmOutreachEvents)
    // Same rule as deriveOutreachState: notes (invites, auto-replies, hand
    // notes) are not messages. Checked for equivalence in verify-email-ingest.
    .where(and(inArray(cmOutreachEvents.partnershipId, partnershipIds), ne(cmOutreachEvents.kind, "note")))
    .groupBy(cmOutreachEvents.partnershipId);

  // Raw sql`` results come back as strings; `timestamp` (no tz) columns are
  // stored as UTC and drizzle's own column mapper reads them as UTC, so do
  // the same here rather than letting Date() assume local time.
  const toDate = (v: Date | string | null) => {
    if (v == null) return null;
    if (v instanceof Date) return v;
    const hasTz = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/.test(v);
    return new Date(hasTz ? v : `${v.replace(" ", "T")}Z`);
  };
  const empty = deriveOutreachState([]);
  for (const id of partnershipIds) map.set(id, empty);
  for (const r of rows) {
    const lastOutboundAt = toDate(r.lastOutboundAt);
    map.set(r.partnershipId, {
      totalOutbound: r.totalOutbound,
      followUpCount: r.followUpCount,
      firstContactAt: toDate(r.firstContactAt),
      lastOutboundAt,
      lastContactAt: toDate(r.lastContactAt),
      repliedAt: toDate(r.repliedAt),
      hasReplied: r.repliedAt != null,
      daysSinceLastOutbound: lastOutboundAt ? daysBetween(lastOutboundAt, now) : null,
      datesAreMigrated: r.totalOutbound > 0 && r.allOutboundMigrated === true,
    });
  }
  return map;
}

/** Full detail for one partnership + creator. */
export async function getPartnershipDetail(partnershipId: string) {
  const [row] = await db
    .select({
      partnership: cmPartnerships,
      creator: cmCreators,
      campaign: cmCampaigns,
    })
    .from(cmPartnerships)
    .innerJoin(cmCreators, eq(cmPartnerships.creatorId, cmCreators.id))
    .innerJoin(cmCampaigns, eq(cmPartnerships.campaignId, cmCampaigns.id))
    .where(eq(cmPartnerships.id, partnershipId))
    .limit(1);
  if (!row) return null;
  row.partnership.stage = canonicalStage(row.partnership.stage);

  const [socials, events, products, shipments, deliverables, otherPartnerships] =
    await Promise.all([
      db.select().from(cmCreatorSocials).where(eq(cmCreatorSocials.creatorId, row.creator.id)).orderBy(desc(cmCreatorSocials.isPrimary)),
      // Bounded: the email sync writes into this table, and a long-running
      // thread would otherwise ship every message body on every page view.
      db.select().from(cmOutreachEvents).where(eq(cmOutreachEvents.partnershipId, partnershipId)).orderBy(desc(cmOutreachEvents.occurredAt)).limit(100),
      db.select().from(cmProductsRequested).where(eq(cmProductsRequested.partnershipId, partnershipId)),
      db.select().from(cmShipments).where(eq(cmShipments.partnershipId, partnershipId)).orderBy(desc(cmShipments.createdAt)),
      db.select().from(cmDeliverables).where(eq(cmDeliverables.partnershipId, partnershipId)).orderBy(desc(cmDeliverables.postedAt)),
      db
        .select({ id: cmPartnerships.id, stage: cmPartnerships.stage, campaignName: cmCampaigns.name })
        .from(cmPartnerships)
        .innerJoin(cmCampaigns, eq(cmPartnerships.campaignId, cmCampaigns.id))
        .where(and(eq(cmPartnerships.creatorId, row.creator.id))),
    ]);

  return {
    ...row,
    socials,
    events,
    products,
    shipments,
    deliverables,
    outreach: deriveOutreachState(events),
    otherPartnerships: otherPartnerships.filter((p) => p.id !== partnershipId),
  };
}


/** Creator rows per campaign (every stage) — for Settings → Campaigns. */
export async function getCampaignCounts(clientId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ campaignId: cmPartnerships.campaignId, n: sql<number>`count(*)::int` })
    .from(cmPartnerships)
    .innerJoin(cmCampaigns, eq(cmCampaigns.id, cmPartnerships.campaignId))
    .where(eq(cmCampaigns.clientId, clientId))
    .groupBy(cmPartnerships.campaignId);
  return new Map(rows.map((r) => [r.campaignId, r.n]));
}

/**
 * When each deal entered the stage it's in now: the latest move into that
 * stage that wasn't undone, preferring a real move over an undo row (an undo
 * returns it to where it was, not a fresh start). Deals with no such move
 * (only ever at their first stage) are absent — callers fall back to createdAt.
 * Selected as a column, so the timestamp keeps its UTC reading.
 */
export async function getStageSince(partnershipIds: string[]): Promise<Map<string, Date>> {
  if (!partnershipIds.length) return new Map();
  const rows = await db
    .selectDistinctOn([cmStageTransitions.partnershipId], { id: cmStageTransitions.partnershipId, at: cmStageTransitions.changedAt })
    .from(cmStageTransitions)
    .innerJoin(cmPartnerships, and(eq(cmPartnerships.id, cmStageTransitions.partnershipId), eq(cmStageTransitions.toStage, cmPartnerships.stage)))
    .where(and(inArray(cmStageTransitions.partnershipId, partnershipIds), isNull(cmStageTransitions.undoneAt)))
    .orderBy(cmStageTransitions.partnershipId, sql`(coalesce(${cmStageTransitions.reason}, '') = 'undo')`, desc(cmStageTransitions.changedAt));
  return new Map(rows.map((r) => [r.id, r.at]));
}
