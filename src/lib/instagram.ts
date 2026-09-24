import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmCreators } from "@/lib/db/schema";
import { fetchProfiles, type ApifyProfile } from "@/lib/apify";
import { addCreatorEmail } from "@/lib/creator-emails";
import { savePhoto } from "@/lib/photos";

/**
 * "Refresh from Instagram" for any number of creators: followers, their
 * profile picture, and their public email — which only ever fills an empty
 * one (a different address is added alongside, never swapped in). Used by
 * the creator page, the bulk bar, adding a creator, CSV import and the
 * backfill. Only real Instagram handles are looked up: a creator entered by
 * name alone has no handle to fetch, and guessing one would attach a
 * stranger's picture.
 */

const BATCH = 25;

/** Pure: a handle Instagram could actually have (letters, digits, "." and "_", ≤ 30). */
export function isInstagramHandle(h: string | null | undefined): h is string {
  return !!h && /^[a-z0-9._]{1,30}$/i.test(h) && !/^\.|\.$|\.\./.test(h);
}

export interface RefreshResult {
  looked: number;
  found: number;
  photos: number;
  emailsFound: number;
  /** Creators with no Instagram handle to look up. */
  skipped: number;
  errors: string[];
}

export async function refreshFromInstagram(creatorIds: string[], opts: { fetch?: typeof fetchProfiles } = {}): Promise<RefreshResult> {
  const result: RefreshResult = { looked: 0, found: 0, photos: 0, emailsFound: 0, skipped: 0, errors: [] };
  if (creatorIds.length === 0) return result;
  const rows = await db
    .select({ id: cmCreators.id, username: cmCreators.username, platform: cmCreators.platform, businessEmail: cmCreators.businessEmail })
    .from(cmCreators)
    .where(inArray(cmCreators.id, [...new Set(creatorIds)]));
  const lookable = rows.filter((r) => r.platform === "instagram" && isInstagramHandle(r.username));
  result.skipped = rows.length - lookable.length;
  const get = opts.fetch ?? fetchProfiles;

  for (let i = 0; i < lookable.length; i += BATCH) {
    const batch = lookable.slice(i, i + BATCH);
    result.looked += batch.length;
    let profiles: ApifyProfile[];
    try {
      profiles = await get(batch.map((r) => r.username.toLowerCase()));
    } catch (e) {
      result.errors.push((e as Error).message);
      continue;
    }
    const byHandle = new Map(profiles.map((p) => [p.username, p]));
    for (const r of batch) {
      const p = byHandle.get(r.username.toLowerCase());
      if (!p) continue;
      result.found++;
      const found = p.businessEmail?.trim().toLowerCase() || null;
      await db
        .update(cmCreators)
        .set({
          followers: p.followersCount ?? undefined,
          businessEmail: !r.businessEmail && found ? found : undefined,
          lastRefreshedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(cmCreators.id, r.id));
      if (found) {
        result.emailsFound++;
        if (r.businessEmail && r.businessEmail.toLowerCase() !== found) await addCreatorEmail(r.id, found, "apify").catch(() => undefined);
      }
      if (p.profilePicUrl) {
        const saved = await savePhoto(r.id, p.profilePicUrl);
        if (saved.ok) result.photos++;
        else result.errors.push(`${r.username}: picture ${saved.error}`);
      }
    }
  }
  return result;
}
