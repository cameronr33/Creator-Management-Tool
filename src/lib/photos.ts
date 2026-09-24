import { db } from "@/lib/db";
import { cmCreatorPhotos } from "@/lib/db/schema";

/**
 * Profile pictures. Instagram's picture links expire within days and refuse
 * to load on other sites, so the picture is downloaded once, on the server,
 * and served from the app. Only Instagram's own image hosts are fetched, only
 * JPEG / PNG / WebP (checked from the bytes, not the claimed type — never SVG,
 * which can carry script), at most 2 MB, within 10 seconds.
 */

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

/** Pure: is this a picture link we're willing to fetch? */
export function isAllowedPhotoUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  return host.endsWith(".cdninstagram.com") || host.endsWith(".fbcdn.net");
}

/** Pure: the image type from its first bytes, or null when it isn't one we keep. */
export function sniffImageType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export type PhotoFetch = { ok: true; mime: string; data: string } | { ok: false; error: string };

/** Download a picture link, with every check above. Never throws. */
export async function downloadPhoto(url: string): Promise<PhotoFetch> {
  if (!isAllowedPhotoUrl(url)) return { ok: false, error: "not an Instagram picture link" };
  try {
    // redirect: "error" — a redirect could point anywhere; the host check must hold.
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) return { ok: false, error: "picture too large" };
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return { ok: false, error: "picture too large" };
    const mime = sniffImageType(buf);
    if (!mime) return { ok: false, error: "not a JPEG, PNG or WebP picture" };
    return { ok: true, mime, data: Buffer.from(buf).toString("base64") };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Download and keep a creator's picture (replacing any older one). */
export async function savePhoto(creatorId: string, url: string): Promise<PhotoFetch> {
  const got = await downloadPhoto(url);
  if (!got.ok) return got;
  const now = new Date();
  await db
    .insert(cmCreatorPhotos)
    .values({ creatorId, mime: got.mime, data: got.data, sourceUrl: url, fetchedAt: now })
    .onConflictDoUpdate({ target: cmCreatorPhotos.creatorId, set: { mime: got.mime, data: got.data, sourceUrl: url, fetchedAt: now } });
  return got;
}
