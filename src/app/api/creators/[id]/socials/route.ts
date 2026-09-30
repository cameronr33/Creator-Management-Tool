import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAgency, badRequest, errorResponse, assertCreatorInSelectedClient } from "@/lib/api-helpers";
import { addCreatorSocial, removeCreatorSocial, setPrimarySocial } from "@/lib/creators";

const postSchema = z.object({
  url: z.string().min(1).optional(),
  /** Pass socialId alone to promote an existing link to primary. */
  socialId: z.string().uuid().optional(),
  makePrimary: z.boolean().optional(),
});

const deleteSchema = z.object({ socialId: z.string().uuid() });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAgency();
  if (error) return error;

  const { id } = await ctx.params;
  const scope = await assertCreatorInSelectedClient(id);
  if (scope) return scope;
  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return badRequest("That doesn't look like a profile link. Paste the full address, starting with https://.", parsed.error.flatten());
  const d = parsed.data;

  try {
    if (d.socialId && d.makePrimary) {
      await setPrimarySocial(id, d.socialId);
      return NextResponse.json({ ok: true });
    }
    if (!d.url) return badRequest("Paste the profile link first.");
    const link = await addCreatorSocial(id, d.url);
    return NextResponse.json({ ok: true, link });
  } catch (e) {
    return errorResponse(e, "Couldn't save that link. Try again in a moment.");
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAgency();
  if (error) return error;

  const { id } = await ctx.params;
  const scope = await assertCreatorInSelectedClient(id);
  if (scope) return scope;
  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return badRequest("Couldn't remove that link. Reload the page and try again.");

  await removeCreatorSocial(id, parsed.data.socialId);
  return NextResponse.json({ ok: true });
}
