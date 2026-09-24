import { cache } from "react";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  clients,
  cmCampaigns,
  cmCreators,
  cmPartnerships,
  cmOutreachEvents,
  cmShipments,
  cmDeliverables,
  cmProductsRequested,
  cmCreatorSocials,
  cmResearchRuns,
  cmClientSettings,
  type CmStage,
} from "@/lib/db/schema";
import { canonicalStage } from "@/lib/stages";
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
    })
    .from(cmPartnerships)
    .innerJoin(cmCreators, eq(cmPartnerships.creatorId, cmCreators.id))
    .innerJoin(cmCampaigns, eq(cmPartnerships.campaignId, cmCampaigns.id))
    .where(and(...conds))
    .orderBy(desc(cmCreators.followers));

  if (rows.length === 0) return [];
  // A retired stage value can only appear in the window before stages:migrate
  // runs; show it as the stage it now means rather than dropping the row.
  for (const r of rows) r.stage = canonicalStage(r.stage);
  if (opts?.withOutreach === false) {
    return rows.map((r) => ({ ...r, lastOutboundAt: null, repliedAt: null, followUpCount: 0 }));
  }

  const partnershipIds = rows.map((r) => r.partnershipId);
  const outreachByPartnership = await getOutreachStates(partnershipIds);

  return rows.map((r) => {
    const st = outreachByPartnership.get(r.partnershipId);
    return {
      ...r,
      lastOutboundAt: st?.lastOutboundAt ?? null,
      repliedAt: st?.repliedAt ?? null,
      followUpCount: st?.followUpCount ?? 0,
    };
  });
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

/** Run history for /import — never the rawPayload blob (the whole ingest, megabytes). */
export async function getResearchRuns(clientId: string, limit = 15) {
  return db
    .select({
      id: cmResearchRuns.id,
      clientId: cmResearchRuns.clientId,
      campaignId: cmResearchRuns.campaignId,
      source: cmResearchRuns.source,
      status: cmResearchRuns.status,
      handleCount: cmResearchRuns.handleCount,
      createdCount: cmResearchRuns.createdCount,
      updatedCount: cmResearchRuns.updatedCount,
      errors: cmResearchRuns.errors,
      startedAt: cmResearchRuns.startedAt,
      completedAt: cmResearchRuns.completedAt,
    })
    .from(cmResearchRuns)
    .where(eq(cmResearchRuns.clientId, clientId))
    .orderBy(desc(cmResearchRuns.startedAt))
    .limit(limit);
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
