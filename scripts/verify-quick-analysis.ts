/**
 * Verifies the "Full Analysis" (two-pass research) feature.
 *
 *   npx tsx --env-file=.env.local scripts/verify-quick-analysis.ts
 *
 * Part 1 (pure) checks aggregateReels's math offline — no network, no DB.
 * Part 2 exercises the research-request lifecycle against the database using
 * a throwaway creator/campaign, then cleans up everything it created. Neither
 * part calls Apify or the Claude API — this verifies the plumbing, not the
 * external calls, which is exactly what CI/offline verification should cover.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { aggregateReels } from "../src/lib/quick-analysis";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";
import { listQueuedRequests, getLatestRequestForPartnership } from "../src/lib/research-requests";
import type { ApifyReel } from "../src/lib/apify";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

function reel(shortCode: string, timestamp: string, plays: number, caption = ""): ApifyReel {
  return {
    shortCode,
    timestamp,
    videoPlayCount: plays,
    likesCount: null,
    commentsCount: null,
    videoDuration: null,
    caption,
    ownerUsername: "verify_test",
  };
}

async function main() {
  console.log("\n── aggregateReels: empty input ──");
  const empty = aggregateReels([]);
  check("reelCount 0", empty.reelCount === 0);
  check("avgViews 0", empty.avgViews === 0);
  check("medianViews 0", empty.medianViews === 0);
  check("maxViews 0", empty.maxViews === 0);
  check("dateOldest null", empty.dateOldest === null);
  check("dateNewest null", empty.dateNewest === null);
  check("spanDays 0", empty.spanDays === 0);
  check("cadencePerWeek 0", empty.cadencePerWeek === 0);
  check("top3 empty", empty.top3.length === 0);

  console.log("\n── aggregateReels: single reel ──");
  const single = aggregateReels([reel("AAA", "2026-01-01T00:00:00Z", 1000)]);
  check("reelCount 1", single.reelCount === 1);
  check("avgViews = the one reel", single.avgViews === 1000);
  check("medianViews = the one reel", single.medianViews === 1000);
  check("maxViews = the one reel", single.maxViews === 1000);
  check("dateOldest = dateNewest", single.dateOldest === single.dateNewest && single.dateOldest === "2026-01-01");
  check("spanDays floors at 1, not 0", single.spanDays === 1, `got ${single.spanDays}`);
  check("cadence = 7/wk for a single-day span", single.cadencePerWeek === 7, `got ${single.cadencePerWeek}`);

  console.log("\n── aggregateReels: three reels, known math ──");
  const three = aggregateReels([
    reel("JAN1", "2026-01-01T00:00:00Z", 1000, "New Year post"),
    reel("JAN8", "2026-01-08T00:00:00Z", 5000, "Viral one"),
    reel("JAN15", "2026-01-15T00:00:00Z", 3000, "Follow-up"),
  ]);
  check("reelCount 3", three.reelCount === 3);
  check("avgViews = 3000", three.avgViews === 3000, `got ${three.avgViews}`);
  check("medianViews = 3000", three.medianViews === 3000, `got ${three.medianViews}`);
  check("maxViews = 5000", three.maxViews === 5000, `got ${three.maxViews}`);
  check("dateOldest = 2026-01-01", three.dateOldest === "2026-01-01");
  check("dateNewest = 2026-01-15", three.dateNewest === "2026-01-15");
  check("spanDays = 14", three.spanDays === 14, `got ${three.spanDays}`);
  check("cadence = 1.5/wk (3 reels / 2 weeks)", three.cadencePerWeek === 1.5, `got ${three.cadencePerWeek}`);
  check(
    "top3 sorted desc by plays: JAN8, JAN15, JAN1",
    three.top3.map((r) => r.shortCode).join(",") === "JAN8,JAN15,JAN1",
    three.top3.map((r) => r.shortCode).join(","),
  );

  console.log("\n── aggregateReels: caps at 3 even with more reels ──");
  const four = aggregateReels([
    reel("A", "2026-01-01T00:00:00Z", 100),
    reel("B", "2026-01-02T00:00:00Z", 400),
    reel("C", "2026-01-03T00:00:00Z", 300),
    reel("D", "2026-01-04T00:00:00Z", 200),
  ]);
  check("top3 has exactly 3 entries from 4 reels", four.top3.length === 3, `got ${four.top3.length}`);
  check("top3 excludes the lowest (A)", !four.top3.some((r) => r.shortCode === "A"));

  console.log("\n── Research-request lifecycle (live DB, cleaned up after) ──");
  const [client] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(eq(schema.clients.slug, "hella"))
    .limit(1);
  if (!client) {
    console.log("  [FAIL] HELLA client not found — cannot run DB checks");
    failures++;
    return;
  }

  const TEST_CAMPAIGN = "__verify_quick_analysis__";
  const campaignId = await ensureCampaignByName(client.id, TEST_CAMPAIGN);
  const { creatorId, partnershipId } = await createCreatorWithPartnership({
    clientId: client.id,
    name: "Verify Quick Analysis Creator",
    links: ["https://www.instagram.com/__verify_qa_test__"],
    campaignId,
    stage: "researched",
  });

  const [created] = await db
    .insert(schema.cmResearchRequests)
    .values({ creatorId, clientId: client.id, campaignId, status: "queued" })
    .returning();
  check("request created with status queued", created.status === "queued");
  check("quickPassAt starts null", created.quickPassAt === null);

  const queued = await listQueuedRequests();
  const inQueue = queued.find((r) => r.requestId === created.id);
  check("appears in listQueuedRequests()", !!inQueue);
  check("carries the right client/campaign/username", inQueue?.clientSlug === "hella" && inQueue?.campaignName === TEST_CAMPAIGN && inQueue?.username === "__verify_qa_test__", JSON.stringify(inQueue));

  const latest1 = await getLatestRequestForPartnership(partnershipId);
  check("getLatestRequestForPartnership finds it", latest1?.id === created.id);

  // Simulate the instant pass landing (what runQuickAnalysis stamps).
  await db
    .update(schema.cmResearchRequests)
    .set({ quickPassAt: new Date() })
    .where(eq(schema.cmResearchRequests.id, created.id));
  const afterQuickPass = await getLatestRequestForPartnership(partnershipId);
  check("quickPassAt gets stamped", afterQuickPass?.quickPassAt != null);
  check("status stays queued after the instant pass (waiting on the local runner)", afterQuickPass?.status === "queued");

  // Simulate the local runner: claim -> complete (mirrors the PATCH route).
  await db
    .update(schema.cmResearchRequests)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(schema.cmResearchRequests.id, created.id));
  const stillQueued = await listQueuedRequests();
  check("no longer listed as queued once claimed", !stillQueued.some((r) => r.requestId === created.id));

  await db
    .update(schema.cmResearchRequests)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(schema.cmResearchRequests.id, created.id));
  const final = await getLatestRequestForPartnership(partnershipId);
  check("final status completed", final?.status === "completed");
  check("completedAt stamped", final?.completedAt != null);

  // Cleanup — deleting the creator cascades to the partnership and the
  // research request (both declared onDelete: cascade against cm_creators).
  await db.delete(schema.cmCreators).where(eq(schema.cmCreators.id, creatorId));
  await db
    .delete(schema.cmCampaigns)
    .where(eq(schema.cmCampaigns.id, campaignId));

  const leftoverRequest = await db
    .select({ id: schema.cmResearchRequests.id })
    .from(schema.cmResearchRequests)
    .where(eq(schema.cmResearchRequests.id, created.id));
  check("research request cascade-deleted with the creator", leftoverRequest.length === 0);
}

main()
  .then(() => {
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
