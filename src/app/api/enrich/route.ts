import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAgency, badRequest, assertCreatorInSelectedClient } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { cmCreators } from "@/lib/db/schema";
import { fetchProfiles } from "@/lib/apify";
import { parseSocialUrl } from "@/lib/social-links";
import { refreshFromInstagram } from "@/lib/instagram";
import { checkEmailForNewAddress } from "@/lib/gmail-sync";

const schema = z.union([
  /** Preview — look up a pasted link before the creator exists. Never writes. */
  z.object({ url: z.string().min(1), creatorId: z.undefined().optional(), save: z.literal(false).optional() }),
  /** Refresh a creator from their own Instagram link, and save it. */
  z.object({ creatorId: z.string().uuid(), url: z.undefined().optional(), save: z.literal(true) }),
]);

/**
 * "Fetch" on the add form (preview a pasted link, nothing saved) and
 * "Refresh from Instagram" on a creator (followers, picture, and a public
 * email only where none is saved). Saving always goes through
 * refreshFromInstagram, which checks nothing but the creator's own Instagram
 * link — a request can't point a creator at someone else's profile. View
 * counts are never touched: those come from the research file.
 *
 * Never throws on a missing token or a private profile: it returns
 * { ok: false, error } so the form can fall back to typing it in.
 */
export async function POST(req: NextRequest) {
  const { error } = await requireAgency();
  if (error) return error;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Send either a link to preview, or a creator to refresh — not both", parsed.error.flatten());
  const d = parsed.data;

  if (d.creatorId) {
    const scope = await assertCreatorInSelectedClient(d.creatorId);
    if (scope) return scope;
    try {
      const r = await refreshFromInstagram([d.creatorId]);
      if (r.skipped) return NextResponse.json({ ok: false, error: "No Instagram link on this creator yet — add one under Profile first." });
      if (r.errors.length && !r.found) return NextResponse.json({ ok: false, error: r.errors[0] });
      if (!r.found) return NextResponse.json({ ok: false, error: "No profile returned — it may be private." });
      if (r.emailsFound) after(() => checkEmailForNewAddress());
      const [c] = await db.select({ followers: cmCreators.followers }).from(cmCreators).where(eq(cmCreators.id, d.creatorId)).limit(1);
      return NextResponse.json({ ok: true, followers: c?.followers ?? null, photo: r.photos > 0 });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message });
    }
  }

  const link = parseSocialUrl(d.url!);
  if (!link?.handle || link.platform !== "instagram") {
    return NextResponse.json({ ok: false, error: "Only Instagram profiles can be looked up — fill the rest in by hand." });
  }
  try {
    const [profile] = await fetchProfiles([link.handle]);
    if (!profile) return NextResponse.json({ ok: false, error: "No profile returned — it may be private." });
    return NextResponse.json({ ok: true, name: profile.fullName, followers: profile.followersCount, businessEmail: profile.businessEmail });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message });
  }
}
