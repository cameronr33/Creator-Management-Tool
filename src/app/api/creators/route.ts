import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, badRequest, assertClientIsSelected, assertCampaignInSelectedClient } from "@/lib/api-helpers";
import { createCreatorWithPartnership, ensureCampaignByName } from "@/lib/creators";
import { STARTING_STAGES } from "@/lib/stages";
import { checkEmailForNewAddress } from "@/lib/gmail-sync";

const schema = z
  .object({
    clientId: z.string().uuid(),
    name: z.string().default(""),
    links: z.array(z.string()).default([]),
    campaignId: z.string().uuid().optional(),
    campaignName: z.string().optional(),
    // Before Shipping only: later stages need their shipment / video records, so move them after adding.
    stage: z.enum(STARTING_STAGES).optional(),
    businessEmail: z.string().nullable().optional(),
    contentPillar: z.string().nullable().optional(),
    followers: z.number().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .refine((d) => d.campaignId || d.campaignName, {
    message: "Pick a campaign or provide a new campaign name",
  })
  .refine((d) => d.name.trim() !== "" || d.links.some((l) => l.trim() !== ""), {
    message: "Provide a name or at least one profile link",
  });

export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid creator", parsed.error.flatten());
  const d = parsed.data;
  const scope = (await assertClientIsSelected(d.clientId)) ?? (d.campaignId ? await assertCampaignInSelectedClient(d.campaignId) : null);
  if (scope) return scope;

  try {
    const campaignId =
      d.campaignId ?? (await ensureCampaignByName(d.clientId, d.campaignName!.trim()));

    const result = await createCreatorWithPartnership({
      clientId: d.clientId,
      name: d.name,
      links: d.links.filter((l) => l.trim() !== ""),
      campaignId,
      stage: d.stage,
      businessEmail: d.businessEmail ?? null,
      contentPillar: d.contentPillar ?? null,
      followers: d.followers ?? null,
      notes: d.notes ?? null,
      userId: session.user.id,
    });

    if (d.businessEmail) after(() => checkEmailForNewAddress());
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return badRequest((e as Error).message);
  }
}
