/**
 * Thin wrapper over the Apify REST API for the server-side (headless) metric
 * refresh. This is TIER 1 only: profile-level metadata and videoPlayCount.
 *
 * It deliberately does NOT try to produce Instagram's public "Views" number —
 * Step 5 of the creator-research skill explains why that requires a logged-in
 * Chrome grid scrape (the two figures differ by up to 100x on viral reels).
 * Accurate views come from the TIER 2 local loop, which runs the full skill and
 * pushes via /api/ingest/research.
 */

const APIFY_BASE = "https://api.apify.com/v2";
const INSTAGRAM_SCRAPER = "apify~instagram-scraper";

export interface ApifyProfile {
  username: string;
  fullName: string | null;
  followersCount: number | null;
  businessEmail: string | null;
  verified: boolean;
}

/** Same shape as the KEEP_FIELDS in .claude/skills/creator-research/scripts/aggregate_metrics.py */
export interface ApifyReel {
  shortCode: string | null;
  timestamp: string | null;
  videoPlayCount: number | null;
  likesCount: number | null;
  commentsCount: number | null;
  videoDuration: number | null;
  caption: string | null;
  ownerUsername: string | null;
}

function token(): string {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error("APIFY_TOKEN is not set");
  return t;
}

/**
 * Run the instagram-scraper actor in "details" mode for a batch of profile
 * URLs and return profile metadata. Synchronous run-and-get-dataset endpoint.
 */
export async function fetchProfiles(usernames: string[]): Promise<ApifyProfile[]> {
  if (usernames.length === 0) return [];

  const directUrls = usernames.map((u) => `https://www.instagram.com/${u}/`);
  const res = await fetch(
    `${APIFY_BASE}/acts/${INSTAGRAM_SCRAPER}/run-sync-get-dataset-items`,
    {
      method: "POST",
      // Bearer header, never ?token= — query strings land in access logs.
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
      signal: AbortSignal.timeout(150_000),
      body: JSON.stringify({
        directUrls,
        resultsType: "details",
        resultsLimit: 1,
        addParentData: false,
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify run failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }

  const items = (await res.json()) as Record<string, unknown>[];
  const wanted = new Set(usernames.map((u) => u.toLowerCase()));
  return items
    .map((it) => ({
      username: String(it.username ?? "").toLowerCase(),
      fullName: (it.fullName as string) ?? null,
      followersCount: typeof it.followersCount === "number" ? it.followersCount : null,
      businessEmail: (it.businessEmail as string) ?? (it.publicEmail as string) ?? null,
      verified: Boolean(it.verified),
    }))
    // A redirected/renamed handle can come back as a different profile —
    // never attach a stranger's numbers to a creator.
    .filter((p) => wanted.has(p.username));
}

/**
 * Run the instagram-scraper actor in "posts" mode for one profile and return
 * up to `limit` reels. This is the SAME provisional data source as Step 1 of
 * the creator-research skill, and carries the same caveat: `videoPlayCount`
 * is NOT Instagram's public "Views" number (see the file header). Used for
 * the instant "Full Analysis" server pass — src/lib/quick-analysis.ts labels
 * everything derived from this as `viewsSource: "apify"` / provisional.
 */
export async function fetchReels(username: string, limit = 30): Promise<ApifyReel[]> {
  const res = await fetch(
    `${APIFY_BASE}/acts/${INSTAGRAM_SCRAPER}/run-sync-get-dataset-items`,
    {
      method: "POST",
      // Bearer header, never ?token= — query strings land in access logs.
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
      signal: AbortSignal.timeout(150_000),
      body: JSON.stringify({
        directUrls: [`https://www.instagram.com/${username}/`],
        resultsType: "posts",
        resultsLimit: limit,
        addParentData: false,
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify run failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }

  const items = (await res.json()) as Record<string, unknown>[];
  return items
    .filter((it) => typeof it.shortCode === "string")
    .map((it) => ({
      shortCode: (it.shortCode as string) ?? null,
      timestamp: (it.timestamp as string) ?? null,
      videoPlayCount: typeof it.videoPlayCount === "number" ? it.videoPlayCount : null,
      likesCount: typeof it.likesCount === "number" ? it.likesCount : null,
      commentsCount: typeof it.commentsCount === "number" ? it.commentsCount : null,
      videoDuration: typeof it.videoDuration === "number" ? it.videoDuration : null,
      caption: (it.caption as string) ?? null,
      ownerUsername: (it.ownerUsername as string) ?? username,
    }));
}

export interface ApifyPost {
  shortCode: string | null;
  timestamp: string | null;
  videoPlayCount: number | null;
  likesCount: number | null;
  commentsCount: number | null;
  caption: string | null;
}

/**
 * Fetch specific posts by URL (deliverable metric fetch). Same actor, same
 * provisional-views caveat as fetchReels — callers must label results
 * `metricsSource: "apify"`, never as authoritative public Views.
 */
export async function fetchPosts(urls: string[]): Promise<ApifyPost[]> {
  if (urls.length === 0) return [];
  const res = await fetch(
    `${APIFY_BASE}/acts/${INSTAGRAM_SCRAPER}/run-sync-get-dataset-items`,
    {
      method: "POST",
      // Bearer header, never ?token= — query strings land in access logs.
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
      signal: AbortSignal.timeout(150_000),
      body: JSON.stringify({
        directUrls: urls,
        resultsType: "posts",
        resultsLimit: urls.length,
        addParentData: false,
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify run failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }

  const items = (await res.json()) as Record<string, unknown>[];
  return items
    .filter((it) => typeof it.shortCode === "string")
    .map((it) => ({
      shortCode: (it.shortCode as string) ?? null,
      timestamp: (it.timestamp as string) ?? null,
      videoPlayCount: typeof it.videoPlayCount === "number" ? it.videoPlayCount : null,
      likesCount: typeof it.likesCount === "number" ? it.likesCount : null,
      commentsCount: typeof it.commentsCount === "number" ? it.commentsCount : null,
      caption: (it.caption as string) ?? null,
    }));
}
