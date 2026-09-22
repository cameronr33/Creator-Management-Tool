/**
 * Thin wrapper over the Apify REST API for "Refresh from Instagram": profile
 * details only (name, followers, public email).
 *
 * It deliberately never produces view counts — Instagram's public "Views"
 * number needs the logged-in Chrome grid scrape in the creator-research skill,
 * whose CSV is imported on Creators → Import.
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

