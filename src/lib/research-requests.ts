import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cmCreators,
  cmCampaigns,
  cmPartnerships,
  cmResearchRequests,
  clients,
  type CmResearchRequest,
} from "@/lib/db/schema";
import { runQuickAnalysis } from "@/lib/quick-analysis";

const OPEN_STATUSES = ["queued", "running"] as const;

/**
 * Create (or reuse) a research request for the partnership's creator, then run
 * the instant Apify-only pass in the background. Only one open request per
 * creator — re-clicking Full Analysis while one is in flight just returns it,
 * rather than firing a second Apify run.
 */
export async function requestFullAnalysis(
  partnershipId: string,
  userId?: string,
): Promise<{ request: CmResearchRequest; created: boolean; rerunQuickPass: boolean }> {
  const [row] = await db
    .select({
      creatorId: cmPartnerships.creatorId,
      campaignId: cmPartnerships.campaignId,
      clientId: cmCreators.clientId,
    })
    .from(cmPartnerships)
    .innerJoin(cmCreators, eq(cmPartnerships.creatorId, cmCreators.id))
    .where(eq(cmPartnerships.id, partnershipId))
    .limit(1);
  if (!row) throw new Error("Partnership not found");

  const [existing] = await db
    .select()
    .from(cmResearchRequests)
    .where(
      and(
        eq(cmResearchRequests.creatorId, row.creatorId),
        inArray(cmResearchRequests.status, OPEN_STATUSES),
      ),
    )
    .orderBy(desc(cmResearchRequests.requestedAt))
    .limit(1);

  if (existing) {
    // Re-clicking onto an open request: the accurate pass is still pending, so
    // don't queue a duplicate — but DO re-run the instant pass when the
    // previous one never landed (after() died) or is stale, otherwise the
    // button is a permanent no-op for this creator.
    const staleMs = 60 * 60 * 1000;
    const quickPassMissing = existing.quickPassAt == null;
    const quickPassStale = existing.quickPassAt != null && Date.now() - existing.quickPassAt.getTime() > staleMs;
    const rerunQuickPass = existing.status === "queued" && (quickPassMissing || quickPassStale);
    return { request: existing, created: false, rerunQuickPass };
  }

  const [created] = await db
    .insert(cmResearchRequests)
    .values({
      creatorId: row.creatorId,
      clientId: row.clientId,
      campaignId: row.campaignId,
      status: "queued",
      requestedBy: userId ?? null,
    })
    .returning();

  return { request: created, created: true, rerunQuickPass: false };
}

/**
 * Runs the instant Apify pass for a freshly created request. Callers running
 * inside a route handler should schedule this via Next's `after()` so the
 * click responds immediately while this keeps running post-response — see
 * src/app/api/analyze/route.ts. Never throws: a quick-pass failure shouldn't
 * surface as an error on the create call, since the accurate local pass can
 * still complete the request later.
 */
export async function runQuickAnalysisInBackground(requestId: string): Promise<void> {
  try {
    await runQuickAnalysis(requestId);
  } catch (err) {
    console.error(`Quick analysis failed for request ${requestId}:`, err);
  }
}

/** Latest request for the creator behind this partnership, for the status-poll UI. */
export async function getLatestRequestForPartnership(
  partnershipId: string,
): Promise<CmResearchRequest | null> {
  const [row] = await db
    .select({ creatorId: cmPartnerships.creatorId })
    .from(cmPartnerships)
    .where(eq(cmPartnerships.id, partnershipId))
    .limit(1);
  if (!row) return null;

  const [request] = await db
    .select()
    .from(cmResearchRequests)
    .where(eq(cmResearchRequests.creatorId, row.creatorId))
    .orderBy(desc(cmResearchRequests.requestedAt))
    .limit(1);
  return request ?? null;
}

export interface QueuedRequestForRunner {
  requestId: string;
  clientSlug: string;
  campaignName: string;
  username: string;
  name: string;
  contentPillar: string | null;
}

/** What the local queue_client.py needs to run the real skill against a request. */
export async function listQueuedRequests(): Promise<QueuedRequestForRunner[]> {
  const rows = await db
    .select({
      requestId: cmResearchRequests.id,
      clientSlug: clients.slug,
      campaignName: cmCampaigns.name,
      username: cmCreators.username,
      name: cmCreators.name,
      contentPillar: cmCreators.contentPillar,
    })
    .from(cmResearchRequests)
    .innerJoin(cmCreators, eq(cmResearchRequests.creatorId, cmCreators.id))
    .innerJoin(cmCampaigns, eq(cmResearchRequests.campaignId, cmCampaigns.id))
    .innerJoin(clients, eq(cmResearchRequests.clientId, clients.id))
    .where(eq(cmResearchRequests.status, "queued"))
    .orderBy(cmResearchRequests.requestedAt);
  return rows;
}
