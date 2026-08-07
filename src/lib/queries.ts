import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
  cmCreatorReels,
  cmCreatorSocials,
  cmAlerts,
  cmMessageTemplates,
  cmResearchRuns,
  cmApiKeys,
  type CmStage,
} from "@/lib/db/schema";
import { deriveOutreachState, type OutreachState } from "@/lib/outreach";

export type ActiveClient = { id: string; name: string; slug: string };

export async function getClients(): Promise<ActiveClient[]> {
  return db
    .select({ id: clients.id, name: clients.name, slug: clients.slug })
    .from(clients)
    .where(eq(clients.isActive, true))
    .orderBy(clients.name);
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
  lastOutboundAt: Date | null;
  repliedAt: Date | null;
  followUpCount: number;
}

export async function getCreatorRows(
  clientId: string,
  opts?: { campaignId?: string; stage?: CmStage },
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
    })
    .from(cmPartnerships)
    .innerJoin(cmCreators, eq(cmPartnerships.creatorId, cmCreators.id))
    .innerJoin(cmCampaigns, eq(cmPartnerships.campaignId, cmCampaigns.id))
    .where(and(...conds))
    .orderBy(desc(cmCreators.followers));

  if (rows.length === 0) return [];

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

/** Derive outreach state for many partnerships in one query. */
export async function getOutreachStates(
  partnershipIds: string[],
): Promise<Map<string, OutreachState>> {
  const map = new Map<string, OutreachState>();
  if (partnershipIds.length === 0) return map;

  const events = await db
    .select({
      partnershipId: cmOutreachEvents.partnershipId,
      occurredAt: cmOutreachEvents.occurredAt,
      direction: cmOutreachEvents.direction,
      kind: cmOutreachEvents.kind,
      isMigrated: cmOutreachEvents.isMigrated,
    })
    .from(cmOutreachEvents)
    .where(inArray(cmOutreachEvents.partnershipId, partnershipIds));

  const grouped = new Map<string, typeof events>();
  for (const e of events) {
    const arr = grouped.get(e.partnershipId) ?? [];
    arr.push(e);
    grouped.set(e.partnershipId, arr);
  }
  for (const id of partnershipIds) {
    map.set(id, deriveOutreachState(grouped.get(id) ?? []));
  }
  return map;
}

/** Count of partnerships per stage for the given client. */
export async function getStageCounts(clientId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ stage: cmPartnerships.stage, count: sql<number>`count(*)::int` })
    .from(cmPartnerships)
    .innerJoin(cmCreators, eq(cmPartnerships.creatorId, cmCreators.id))
    .where(eq(cmCreators.clientId, clientId))
    .groupBy(cmPartnerships.stage);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.stage] = r.count;
  return out;
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

  const [reels, socials, events, products, shipments, deliverables, otherPartnerships] =
    await Promise.all([
      db.select().from(cmCreatorReels).where(eq(cmCreatorReels.creatorId, row.creator.id)).orderBy(cmCreatorReels.rank),
      db.select().from(cmCreatorSocials).where(eq(cmCreatorSocials.creatorId, row.creator.id)).orderBy(desc(cmCreatorSocials.isPrimary)),
      db.select().from(cmOutreachEvents).where(eq(cmOutreachEvents.partnershipId, partnershipId)).orderBy(desc(cmOutreachEvents.occurredAt)),
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
    reels,
    socials,
    events,
    products,
    shipments,
    deliverables,
    outreach: deriveOutreachState(events),
    otherPartnerships: otherPartnerships.filter((p) => p.id !== partnershipId),
  };
}

export async function getDefaultTemplate(clientId: string) {
  const [tpl] = await db
    .select()
    .from(cmMessageTemplates)
    .where(and(eq(cmMessageTemplates.clientId, clientId), eq(cmMessageTemplates.isDefault, true)))
    .limit(1);
  return tpl ?? null;
}

export async function getResearchRuns(clientId: string, limit = 15) {
  return db
    .select()
    .from(cmResearchRuns)
    .where(eq(cmResearchRuns.clientId, clientId))
    .orderBy(desc(cmResearchRuns.startedAt))
    .limit(limit);
}

export async function getApiKeys() {
  return db.select().from(cmApiKeys).orderBy(desc(cmApiKeys.createdAt));
}

export async function getTemplates(clientId: string) {
  return db
    .select()
    .from(cmMessageTemplates)
    .where(eq(cmMessageTemplates.clientId, clientId))
    .orderBy(desc(cmMessageTemplates.isDefault));
}

export async function getOpenAlerts(clientId: string) {
  return db
    .select({
      alert: cmAlerts,
      partnershipId: cmPartnerships.id,
      name: cmCreators.name,
      username: cmCreators.username,
      stage: cmPartnerships.stage,
    })
    .from(cmAlerts)
    .innerJoin(cmPartnerships, eq(cmAlerts.partnershipId, cmPartnerships.id))
    .innerJoin(cmCreators, eq(cmPartnerships.creatorId, cmCreators.id))
    .where(and(eq(cmCreators.clientId, clientId), eq(cmAlerts.status, "open")))
    .orderBy(cmAlerts.dueAt);
}
