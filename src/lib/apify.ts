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
    `${APIFY_BASE}/acts/${INSTAGRAM_SCRAPER}/run-sync-get-dataset-items?token=${token()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  return items.map((it) => ({
    username: String(it.username ?? "").toLowerCase(),
    fullName: (it.fullName as string) ?? null,
    followersCount: typeof it.followersCount === "number" ? it.followersCount : null,
    businessEmail: (it.businessEmail as string) ?? (it.publicEmail as string) ?? null,
    verified: Boolean(it.verified),
  }));
}
