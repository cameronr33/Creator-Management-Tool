import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAgency, badRequest, assertCreatorInSelectedClient } from "@/lib/api-helpers";
import { eq } from "drizzle-orm";
import { updateCreatorProfile } from "@/lib/creators";
import { removePartnerships } from "@/lib/campaigns";
import { db } from "@/lib/db";
import { cmCreators, cmPartnerships } from "@/lib/db/schema";
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
  const { error } = await requireAgency();
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

/** DELETE /api/creators/[id] — the creator everywhere: every campaign, conversation, shipment and video. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAgency();
  if (error) return error;
  const { id } = await ctx.params;
  const scope = await assertCreatorInSelectedClient(id);
  if (scope) return scope;
  const ps = await db.select({ id: cmPartnerships.id }).from(cmPartnerships).where(eq(cmPartnerships.creatorId, id));
  const r = await removePartnerships(ps.map((p) => p.id));
  // A creator with no partnerships at all (shouldn't exist) is removed directly.
  await db.delete(cmCreators).where(eq(cmCreators.id, id));
  return NextResponse.json({ ok: true, ...r, creatorsDeleted: 1 });
}
