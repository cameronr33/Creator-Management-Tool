/**
 * Pass 1 of "Full Analysis" — the instant, server-side pass that runs the
 * moment the button is clicked.
 *
 * `aggregateReels` is a pure TS port of the math in
 * .claude/skills/creator-research/scripts/aggregate_metrics.py (Step 2 of the
 * skill) — kept pure so it can be unit-tested offline in
 * scripts/verify-quick-analysis.ts without a database or network call.
 *
 * Everything this pass writes is provisional: `viewsSource: "apify"` on the
 * creator record is what drives the `est` badge already rendered by
 * src/components/ui.tsx and the creator detail page. The ACCURATE pass — real
 * public Views via the Chrome grid scrape, and vision-based reel descriptions
 * — can only happen locally; see src/lib/apify.ts and the plan's "Full
 * Analysis" addition for why. That pass is Pass 2, driven by
 * cm_research_requests.status via /api/research-requests.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cmCreators,
  cmCreatorReels,
  cmResearchRequests,
} from "@/lib/db/schema";
import { fetchReels, fetchProfiles, type ApifyReel } from "@/lib/apify";
import { summarizeCreator } from "@/lib/summarize";

export interface ReelAggregate {
  reelCount: number;
  avgViews: number;
  medianViews: number;
  maxViews: number;
  dateOldest: string | null; // YYYY-MM-DD
  dateNewest: string | null; // YYYY-MM-DD
  spanDays: number;
  cadencePerWeek: number;
  /** Sorted by videoPlayCount desc, capped at 3 — mirrors the skill's top_3_shortcodes. */
  top3: ApifyReel[];
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function toDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** Pure aggregation — no I/O. Matches aggregate_metrics.py's summarize_creator(). */
export function aggregateReels(reels: ApifyReel[]): ReelAggregate {
  const plays = reels.map((r) => r.videoPlayCount ?? 0);
  const sortedPlays = [...plays].sort((a, b) => a - b);

  const timestamps = reels
    .map((r) => r.timestamp)
    .filter((t): t is string => !!t)
    .map((t) => new Date(t))
    .filter((d) => !Number.isNaN(d.getTime()));

  let dateOldest: string | null = null;
  let dateNewest: string | null = null;
  let spanDays = 0;
  let cadencePerWeek = 0;

  if (timestamps.length > 0) {
    const oldest = new Date(Math.min(...timestamps.map((d) => d.getTime())));
    const newest = new Date(Math.max(...timestamps.map((d) => d.getTime())));
    dateOldest = toDateOnly(oldest.toISOString());
    dateNewest = toDateOnly(newest.toISOString());
    spanDays = Math.max(Math.round((newest.getTime() - oldest.getTime()) / 86_400_000), 1);
    cadencePerWeek = spanDays ? Math.round((reels.length / (spanDays / 7)) * 100) / 100 : 0;
  }

  const top3 = [...reels]
    .sort((a, b) => (b.videoPlayCount ?? 0) - (a.videoPlayCount ?? 0))
    .slice(0, 3);

  return {
    reelCount: reels.length,
    avgViews: plays.length ? Math.round(plays.reduce((a, b) => a + b, 0) / plays.length) : 0,
    medianViews: Math.round(median(sortedPlays)),
    maxViews: plays.length ? Math.max(...plays) : 0,
    dateOldest,
    dateNewest,
    spanDays,
    cadencePerWeek,
    top3,
  };
}

/** Caption text, trimmed and prefixed so it's never mistaken for the skill's vision-based description. */
function captionDescription(caption: string | null): string | null {
  if (!caption) return null;
  const trimmed = caption.trim().replace(/\s+/g, " ");
  const excerpt = trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
  return `Caption: ${excerpt}`;
}

export interface QuickAnalysisResult {
  creatorId: string;
  reelCount: number;
  followers: number | null;
  summaryWritten: boolean;
}

/**
 * Runs the instant pass for one open cm_research_requests row and stamps
 * quickPassAt. Never throws for "no data" conditions (private/empty
 * accounts) — it just writes what it got and moves on; a hard Apify/network
 * failure does propagate so the caller can mark the request `failed`.
 */
export async function runQuickAnalysis(requestId: string): Promise<QuickAnalysisResult> {
  const [request] = await db
    .select()
    .from(cmResearchRequests)
    .where(eq(cmResearchRequests.id, requestId))
    .limit(1);
  if (!request) throw new Error("Research request not found");

  const [creator] = await db
    .select()
    .from(cmCreators)
    .where(eq(cmCreators.id, request.creatorId))
    .limit(1);
  if (!creator) throw new Error("Creator not found");

  const [reels, profiles] = await Promise.all([
    fetchReels(creator.username, 30),
    fetchProfiles([creator.username]),
  ]);
  const profile = profiles[0] ?? null;
  const agg = aggregateReels(reels);
  const now = new Date();

  // Provisional content summary — best-effort, never blocks the pass.
  let summaryWritten = false;
  let summary: string | null = null;
  try {
    summary = await summarizeCreator({
      name: creator.name,
      followers: profile?.followersCount ?? creator.followers ?? null,
      captions: reels.map((r) => r.caption).filter((c): c is string => !!c),
    });
    summaryWritten = summary != null;
  } catch {
    // ANTHROPIC_API_KEY unset, or the API call failed — the est. data is
    // still worth keeping, so swallow this rather than failing the request.
  }

  // FROZEN RULE: provisional Apify numbers never overwrite accurate ones.
  // A creator whose views came from the Chrome-grid pass (ig_public_chrome)
  // keeps those views and their vision-written reel descriptions; the instant
  // pass may only refresh followers/cadence/date range for them. And an empty
  // Apify result (private account, soft actor failure) must not zero anything.
  const hasAccurateViews = creator.viewsSource === "ig_public_chrome";
  const gotReels = agg.reelCount > 0;

  await db
    .update(cmCreators)
    .set({
      followers: profile?.followersCount ?? creator.followers,
      businessEmail: profile?.businessEmail ?? creator.businessEmail,
      ...(gotReels
        ? {
            reelsPulled: agg.reelCount,
            cadencePerWeek: String(agg.cadencePerWeek),
            dateRangeStart: agg.dateOldest,
            dateRangeEnd: agg.dateNewest,
          }
        : {}),
      ...(gotReels && !hasAccurateViews
        ? {
            avgViews: agg.avgViews,
            medianViews: agg.medianViews,
            maxViews: agg.maxViews,
            viewsSource: "apify" as const,
          }
        : {}),
      contentTypeSummary: summary ?? creator.contentTypeSummary,
      lastRefreshedAt: now,
      updatedAt: now,
    })
    .where(eq(cmCreators.id, creator.id));

  const replacementReels = agg.top3
    .filter((r) => !!r.shortCode)
    .map((reel, i) => ({
      creatorId: creator.id,
      rank: i + 1,
      shortcode: reel.shortCode as string,
      url: `https://www.instagram.com/reel/${reel.shortCode}/`,
      views: reel.videoPlayCount,
      description: captionDescription(reel.caption),
    }));
  // Only replace reels when we have replacements AND the existing ones aren't
  // the accurate pass's vision-described set.
  if (replacementReels.length > 0 && !hasAccurateViews) {
    await db.delete(cmCreatorReels).where(eq(cmCreatorReels.creatorId, creator.id));
    await db.insert(cmCreatorReels).values(replacementReels);
  }

  await db
    .update(cmResearchRequests)
    .set({ quickPassAt: now })
    .where(eq(cmResearchRequests.id, requestId));

  return {
    creatorId: creator.id,
    reelCount: agg.reelCount,
    followers: profile?.followersCount ?? creator.followers,
    summaryWritten,
  };
}
