import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAgency, badRequest, assertCampaignInSelectedClient } from "@/lib/api-helpers";
import { deleteCampaign, renameCampaign } from "@/lib/campaigns";
import { resolveClient } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";

const renameSchema = z.object({ name: z.string().min(1).max(120) });

/** PATCH /api/campaigns/[id] — rename (names are unique per client, ignoring case). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAgency();
  if (error) return error;
  const { id } = await ctx.params;
  const scope = await assertCampaignInSelectedClient(id);
  if (scope) return scope;
  const parsed = renameSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Give the campaign a name");
  const client = (await resolveClient(await getSelectedClientSlug()))!;
  const r = await renameCampaign(client.id, id, parsed.data.name);
  return r.ok ? NextResponse.json({ ok: true }) : badRequest(r.error);
}

/** DELETE /api/campaigns/[id] — the campaign and its creators' rows in it; creators left with no campaign go too. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAgency();
  if (error) return error;
  const { id } = await ctx.params;
  const scope = await assertCampaignInSelectedClient(id);
  if (scope) return scope;
  const client = (await resolveClient(await getSelectedClientSlug()))!;
  const r = await deleteCampaign(client.id, id);
  return r.ok ? NextResponse.json(r) : badRequest("That campaign isn't here any more. Reload the page.");
}
