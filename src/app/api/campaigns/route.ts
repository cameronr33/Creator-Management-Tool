import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAgency, badRequest, assertClientIsSelected } from "@/lib/api-helpers";
import { ensureCampaign, findCampaignByName } from "@/lib/campaigns";

const schema = z.object({
  clientId: z.string().uuid(),
  name: z.string().min(1),
});

/** POST /api/campaigns — create a campaign for the selected client. */
export async function POST(req: NextRequest) {
  const { error } = await requireAgency();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid campaign", parsed.error.flatten());
  const d = parsed.data;
  const scope = await assertClientIsSelected(d.clientId);
  if (scope) return scope;

  if (await findCampaignByName(d.clientId, d.name)) return badRequest("A campaign with that name already exists");
  const c = await ensureCampaign(d.clientId, d.name);
  return NextResponse.json({ ok: true, id: c.id });
}
