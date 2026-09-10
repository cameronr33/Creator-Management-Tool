import { and, eq, lt, or, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmCreators } from "@/lib/db/schema";
import { fetchProfiles } from "@/lib/apify";

export interface RefreshResult {
  candidates: number;
  refreshed: number;
  errors: string[];
}

/**
 * TIER 1 metric refresh — headless-safe. Refreshes follower counts (and name /
 * email if newly public) for creators not refreshed in `staleDays`. Explicitly
 * does NOT touch avgViews / medianViews / maxViews / viewsSource: those numbers
 * are only trustworthy from the TIER 2 Chrome-grid run, and overwriting them
 * with Apify's understated figures would silently corrupt client reports.
 */
export async function refreshCreatorMetrics(opts?: {
  clientId?: string;
  staleDays?: number;
  limit?: number;
}): Promise<RefreshResult> {
  const staleDays = opts?.staleDays ?? 30;
  const limit = opts?.limit ?? 50;
  const cutoff = new Date(Date.now() - staleDays * 86_400_000);

  // Only Instagram profiles: the scraper is Instagram-specific, so a TikTok or
  // website-only creator would be looked up as a stranger's IG handle.
  const staleCond = and(
    eq(cmCreators.platform, "instagram"),
    or(isNull(cmCreators.lastRefreshedAt), lt(cmCreators.lastRefreshedAt, cutoff)),
  );
  const where = opts?.clientId ? and(eq(cmCreators.clientId, opts.clientId), staleCond) : staleCond;

  const candidates = await db
    .select({ id: cmCreators.id, username: cmCreators.username })
    .from(cmCreators)
    .where(where)
    .limit(limit);

  if (candidates.length === 0) return { candidates: 0, refreshed: 0, errors: [] };

  const errors: string[] = [];
  let refreshed = 0;

  let profiles;
  try {
    profiles = await fetchProfiles(candidates.map((c) => c.username));
  } catch (e) {
    return { candidates: candidates.length, refreshed: 0, errors: [(e as Error).message] };
  }

  const byUser = new Map(profiles.map((p) => [p.username, p]));
  const now = new Date();

  for (const c of candidates) {
    const p = byUser.get(c.username);
    if (!p) {
      // Don't stamp lastRefreshedAt: a "fresh" timestamp on a failed lookup
      // would make a private/renamed handle look healthy forever. It stays
      // stale and is retried next run; the error is the signal.
      errors.push(`${c.username}: no profile returned`);
      continue;
    }
    await db
      .update(cmCreators)
      .set({
        followers: p.followersCount ?? undefined,
        businessEmail: sql`coalesce(${cmCreators.businessEmail}, ${p.businessEmail})`,
        lastRefreshedAt: now,
        updatedAt: now,
      })
      .where(eq(cmCreators.id, c.id));
    refreshed++;
  }

  return { candidates: candidates.length, refreshed, errors };
}
