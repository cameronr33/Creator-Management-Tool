import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, badRequest } from "@/lib/api-helpers";
import { updateCreatorProfile } from "@/lib/creators";

const schema = z.object({
  name: z.string().min(1).optional(),
  businessEmail: z.string().nullable().optional(),
  contentPillar: z.string().nullable().optional(),
  followers: z.number().nullable().optional(),
  avgViews: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid profile fields", parsed.error.flatten());

  await updateCreatorProfile(id, parsed.data);
  return NextResponse.json({ ok: true });
}
