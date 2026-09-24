import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth, badRequest, assertCreatorInSelectedClient } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { cmCreators } from "@/lib/db/schema";
import { fetchProfiles } from "@/lib/apify";
import { parseSocialUrl, ENRICHABLE_PLATFORMS, PLATFORM_LABELS } from "@/lib/social-links";
import { addCreatorEmail } from "@/lib/creator-emails";
import { savePhoto } from "@/lib/photos";
import { checkEmailForNewAddress } from "@/lib/gmail-sync";

const schema = z
  .object({
    /** Preview mode — enrich a pasted URL before the creator exists. */
    url: z.string().optional(),
    /** Existing creator; combine with save:true to write the result. */
    creatorId: z.string().uuid().optional(),
    save: z.boolean().default(false),
  })
  .refine((d) => d.url || d.creatorId, { message: "Provide a url or creatorId" });

/**
 * One-click "Fetch" — tier-1 Apify lookup for followers / name / public email.
 *
 * Serves both the add form (preview from a pasted URL, nothing saved) and the
 * detail page (fetch + save onto an existing creator). Only Instagram, TikTok
 * and YouTube are fetchable; Facebook and websites stay manual.
 *
 * Deliberately does NOT touch view metrics — per src/lib/refresh.ts, trustworthy
 * public Views only come from the Chrome-grid (tier-2) run.
 *
 * Never throws on a missing APIFY_TOKEN or a private profile: it returns
 * { ok: false, error } so the form can degrade to manual entry.
 */
export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid request", parsed.error.flatten());
  const d = parsed.data;

  let handle: string | null = null;
  let platform: string | null = null;

  if (d.url) {
    const link = parseSocialUrl(d.url);
    handle = link?.handle ?? null;
    platform = link?.platform ?? null;
  } else {
    const scope = await assertCreatorInSelectedClient(d.creatorId!);
    if (scope) return scope;
    const [creator] = await db
      .select({ username: cmCreators.username, platform: cmCreators.platform })
      .from(cmCreators)
      .where(eq(cmCreators.id, d.creatorId!))
      .limit(1);
    if (!creator) return badRequest("Creator not found");
    handle = creator.username;
    platform = creator.platform;
  }

  if (!handle || !platform || !ENRICHABLE_PLATFORMS.includes(platform as never)) {
    const label = platform ? PLATFORM_LABELS[platform as keyof typeof PLATFORM_LABELS] : "that link";
    return NextResponse.json({
      ok: false,
      error: `Auto-fetch only works for Instagram, TikTok and YouTube — ${label} has to be filled in manually.`,
    });
  }

  try {
    const [profile] = await fetchProfiles([handle]);
    if (!profile) {
      return NextResponse.json({ ok: false, error: "No profile returned — it may be private." });
    }

    if (d.save && d.creatorId) {
      // The tracked address is never silently replaced: Instagram's public
      // email only fills an empty one, and a different one is added alongside.
      const [cur] = await db.select({ businessEmail: cmCreators.businessEmail }).from(cmCreators).where(eq(cmCreators.id, d.creatorId)).limit(1);
      const found = profile.businessEmail?.trim().toLowerCase() || null;
      await db
        .update(cmCreators)
        .set({
          followers: profile.followersCount ?? undefined,
          businessEmail: !cur?.businessEmail && found ? found : undefined,
          lastRefreshedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(cmCreators.id, d.creatorId));
      if (found && cur?.businessEmail && cur.businessEmail.toLowerCase() !== found) {
        await addCreatorEmail(d.creatorId, found, "apify").catch(() => undefined);
      }
      if (found) after(() => checkEmailForNewAddress());
      if (profile.profilePicUrl) await savePhoto(d.creatorId, profile.profilePicUrl);
    }

    return NextResponse.json({
      ok: true,
      name: profile.fullName,
      followers: profile.followersCount,
      businessEmail: profile.businessEmail,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message });
  }
}
