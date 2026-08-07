import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, badRequest } from "@/lib/api-helpers";
import { addCreatorSocial, removeCreatorSocial, setPrimarySocial } from "@/lib/creators";

const postSchema = z.object({
  url: z.string().min(1).optional(),
  /** Pass socialId alone to promote an existing link to primary. */
  socialId: z.string().uuid().optional(),
  makePrimary: z.boolean().optional(),
});

const deleteSchema = z.object({ socialId: z.string().uuid() });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid link", parsed.error.flatten());
  const d = parsed.data;

  try {
    if (d.socialId && d.makePrimary) {
      await setPrimarySocial(id, d.socialId);
      return NextResponse.json({ ok: true });
    }
    if (!d.url) return badRequest("Provide a url");
    const link = await addCreatorSocial(id, d.url);
    return NextResponse.json({ ok: true, link });
  } catch (e) {
    return badRequest((e as Error).message);
  }
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return badRequest("Missing socialId");

  await removeCreatorSocial(parsed.data.socialId);
  return NextResponse.json({ ok: true });
}
