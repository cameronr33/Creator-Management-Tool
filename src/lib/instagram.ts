import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmCreators, cmCreatorSocials } from "@/lib/db/schema";
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

/**
 * Each creator's Instagram handle, taken only from an Instagram link saved on
 * them (primary first) — never from the stored username, which for a creator
 * added by name is a slug of their name and may be someone else's handle.
 */
export async function instagramHandles(creatorIds: string[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(creatorIds)];
  const out = new Map<string, string | null>(ids.map((id) => [id, null]));
  if (!ids.length) return out;
  const socials = await db
    .select({ creatorId: cmCreatorSocials.creatorId, handle: cmCreatorSocials.handle, isPrimary: cmCreatorSocials.isPrimary })
    .from(cmCreatorSocials)
    .where(and(inArray(cmCreatorSocials.creatorId, ids), eq(cmCreatorSocials.platform, "instagram")));
  for (const id of ids) {
    const own = socials.filter((s) => s.creatorId === id && isInstagramHandle(s.handle)).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))[0];
    out.set(id, own?.handle?.toLowerCase() ?? null);
  }
  return out;
}

export async function refreshFromInstagram(creatorIds: string[], opts: { fetch?: typeof fetchProfiles } = {}): Promise<RefreshResult> {
  const result: RefreshResult = { looked: 0, found: 0, photos: 0, emailsFound: 0, skipped: 0, errors: [] };
  if (creatorIds.length === 0) return result;
  const ids = [...new Set(creatorIds)];
  const [creators, handles] = await Promise.all([
    db
      .select({ id: cmCreators.id, businessEmail: cmCreators.businessEmail })
      .from(cmCreators)
      .where(inArray(cmCreators.id, ids)),
    instagramHandles(ids),
  ]);
  const rows = creators.map((c) => ({ ...c, username: handles.get(c.id) ?? "" }));
  const lookable = rows.filter((r) => isInstagramHandle(r.username));
  result.skipped = rows.length - lookable.length;
  const get = opts.fetch ?? fetchProfiles;

  for (let i = 0; i < lookable.length; i += BATCH) {
    const batch = lookable.slice(i, i + BATCH);
    result.looked += batch.length;
    let profiles: ApifyProfile[];
    try {
      profiles = await get(batch.map((r) => r.username.toLowerCase()));
    } catch (e) {
      result.errors.push((e as Error).message); // log-only: the enrich route logs these and shows plain words
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
