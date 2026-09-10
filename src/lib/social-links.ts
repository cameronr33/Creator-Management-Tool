/**
 * Multi-platform social link parsing.
 *
 * Generalizes the Instagram-only helpers in src/lib/csv.ts so a creator can be
 * added by pasting any profile URL. Given a URL or bare handle, works out which
 * platform it is, the handle, and a canonical URL to store.
 */

export type SocialPlatform =
  | "instagram"
  | "tiktok"
  | "youtube"
  | "facebook"
  | "x"
  | "website"
  | "other";

export interface ParsedSocialLink {
  platform: SocialPlatform;
  /** Handle without a leading @, lowercased. Null for bare websites. */
  handle: string | null;
  /** Canonical URL to store and link to. */
  url: string;
}

/** Platforms the Apify tier-1 enrich can actually fetch. */
/** Only Instagram has a scraper wired up (apify~instagram-scraper). */
export const ENRICHABLE_PLATFORMS: SocialPlatform[] = ["instagram"];

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
  x: "X",
  website: "Website",
  other: "Other",
};

/** Strip tracking params, trailing slashes and fragments. */
function tidy(raw: string): string {
  return raw.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
}

function hostOf(raw: string): string | null {
  const m = tidy(raw).match(/^(?:https?:\/\/)?(?:www\.)?([^/]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/** First path segment after the domain, if any. */
function firstSegment(raw: string): string | null {
  const m = tidy(raw).match(/^(?:https?:\/\/)?(?:www\.)?[^/]+\/([^/]+)/i);
  return m ? m[1] : null;
}

function cleanHandle(value: string | null | undefined): string | null {
  if (!value) return null;
  const h = value.trim().replace(/^@/, "").replace(/\/+$/, "");
  return h ? h.toLowerCase() : null;
}

/**
 * Parse a pasted profile URL (or bare @handle) into platform + handle + a
 * canonical URL. A bare handle with no domain is assumed to be Instagram, since
 * that's the dominant platform in this workflow.
 */
export function parseSocialUrl(input: string): ParsedSocialLink | null {
  const raw = tidy(input);
  if (!raw) return null;

  const host = hostOf(raw);
  const looksLikeUrl = /^https?:\/\//i.test(raw) || (host?.includes(".") ?? false);

  // Bare handle → Instagram by convention.
  if (!looksLikeUrl) {
    const handle = cleanHandle(raw);
    if (!handle) return null;
    return {
      platform: "instagram",
      handle,
      url: `https://www.instagram.com/${handle}`,
    };
  }

  if (host?.includes("instagram.com")) {
    const handle = cleanHandle(firstSegment(raw));
    if (!handle) return null;
    return { platform: "instagram", handle, url: `https://www.instagram.com/${handle}` };
  }

  if (host?.includes("tiktok.com")) {
    // https://www.tiktok.com/@handle
    const seg = firstSegment(raw);
    const handle = cleanHandle(seg);
    if (!handle) return null;
    return { platform: "tiktok", handle, url: `https://www.tiktok.com/@${handle}` };
  }

  if (host?.includes("youtube.com") || host?.includes("youtu.be")) {
    const seg = firstSegment(raw);
    // /@handle is the modern form; /channel/UC… and /c/Name are legacy.
    if (seg?.startsWith("@")) {
      const handle = cleanHandle(seg);
      return { platform: "youtube", handle, url: `https://www.youtube.com/@${handle}` };
    }
    if (seg === "channel" || seg === "c" || seg === "user") {
      const m = tidy(raw).match(/\/(?:channel|c|user)\/([^/]+)/i);
      const handle = cleanHandle(m?.[1]);
      return { platform: "youtube", handle, url: tidy(raw) };
    }
    return { platform: "youtube", handle: cleanHandle(seg), url: tidy(raw) };
  }

  if (host?.includes("facebook.com") || host?.includes("fb.com")) {
    const seg = firstSegment(raw);
    // Facebook has many shapes (/profile.php?id=, /pages/…); keep the URL as-is
    // and only treat a simple vanity segment as a handle.
    const handle =
      seg && !seg.includes(".php") && seg !== "pages" ? cleanHandle(seg) : null;
    return { platform: "facebook", handle, url: tidy(raw) };
  }

  if (host === "x.com" || host === "twitter.com" || host?.endsWith(".x.com")) {
    const handle = cleanHandle(firstSegment(raw));
    if (!handle) return null;
    return { platform: "x", handle, url: `https://x.com/${handle}` };
  }

  // Anything else is a website we just store verbatim.
  const url = /^https?:\/\//i.test(raw) ? tidy(raw) : `https://${tidy(raw)}`;
  return { platform: "website", handle: null, url };
}

/**
 * Derive the username used for the (clientId, username) uniqueness key.
 * Prefers the primary link's handle, then a slug of the display name.
 */
export function deriveUsername(
  links: ParsedSocialLink[],
  name: string | null | undefined,
): string | null {
  const withHandle = links.find((l) => l.handle);
  if (withHandle?.handle) return withHandle.handle;
  return slugify(name ?? "") || null;
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    // Drop apostrophes rather than treating them as separators, so
    // "Bob's Garage" slugs to "bobs-garage", not "bob-s-garage".
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
