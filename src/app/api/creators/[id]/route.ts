import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, badRequest, assertCreatorInSelectedClient } from "@/lib/api-helpers";
import { updateCreatorProfile } from "@/lib/creators";
import { checkEmailForNewAddress } from "@/lib/gmail-sync";

const schema = z.object({
  name: z.string().min(1).optional(),
  businessEmail: z.string().trim().email().nullable().optional().or(z.literal("")),
  contentPillar: z.string().nullable().optional(),
  followers: z.number().int().min(0).nullable().optional(),
  avgViews: z.number().int().min(0).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await ctx.params;
  const scope = await assertCreatorInSelectedClient(id);
  if (scope) return scope;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid profile fields", parsed.error.flatten());

  const d = parsed.data;
  await updateCreatorProfile(id, {
    ...d,
    businessEmail: d.businessEmail === "" ? null : d.businessEmail?.toLowerCase(),
  });
  // A new address starts being tracked now: its last 180 days are searched.
  if (d.businessEmail) after(() => checkEmailForNewAddress());
  return NextResponse.json({ ok: true });
}
