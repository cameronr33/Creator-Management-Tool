import { NextResponse, after, type NextRequest } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmPartnerships } from "@/lib/db/schema";
import { refreshFromInstagram } from "@/lib/instagram";
import { z } from "zod";
import {
  requireAuth,
  badRequest,
  assertPartnershipsInSelectedClient,
  assertCampaignInSelectedClient,
} from "@/lib/api-helpers";
import { changeStage } from "@/lib/mutations";
import { moveToCampaign, removePartnerships } from "@/lib/campaigns";
import { STAGE_VALUES } from "@/lib/stages";
import { cmExitReasonEnum } from "@/lib/db/schema";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete"), ids: z.array(z.string()).min(1).max(500) }),
  z.object({
    action: z.literal("set_stage"),
    ids: z.array(z.string()).min(1).max(500),
    stage: z.enum(STAGE_VALUES),
    exitReason: z.enum(cmExitReasonEnum.enumValues).nullable().optional(),
  }),
  z.object({ action: z.literal("set_campaign"), ids: z.array(z.string()).min(1).max(500), campaignId: z.string() }),
  z.object({ action: z.literal("refresh_instagram"), ids: z.array(z.string()).min(1).max(500) }),
]);

/**
 * POST /api/partnerships/bulk — the Creators table's bulk bar (and a single
 * row's "Move to campaign"). Every id must belong to the selected client.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid bulk action", parsed.error.flatten());
  const d = parsed.data;
  const scope = await assertPartnershipsInSelectedClient(d.ids);
  if (scope) return scope;

  if (d.action === "delete") {
    const r = await removePartnerships(d.ids);
    return NextResponse.json({ ok: true, ...r });
  }
  if (d.action === "refresh_instagram") {
    // A lookup takes up to a couple of minutes per 25 creators: answer now, fetch after.
    const rows = await db.selectDistinct({ creatorId: cmPartnerships.creatorId }).from(cmPartnerships).where(inArray(cmPartnerships.id, d.ids));
    after(() => refreshFromInstagram(rows.map((r) => r.creatorId)).then((r) => console.log("[instagram] bulk refresh", r)));
    return NextResponse.json({ ok: true, queued: rows.length });
  }
  if (d.action === "set_campaign") {
    const c = await assertCampaignInSelectedClient(d.campaignId);
    if (c) return c;
    const r = await moveToCampaign(d.ids, d.campaignId);
    return NextResponse.json({ ok: true, ...r });
  }
  // set_stage: each goes through the stage-move core (shipment / video guards, transition rows).
  let moved = 0;
  let unchanged = 0;
  let needVideo = 0;
  for (const id of [...new Set(d.ids)]) {
    const r = await changeStage(id, d.stage, session.user.id, { exitReason: d.exitReason });
    if (r.status === "moved") moved++;
    else if (r.status === "needs_video") needVideo++;
    else unchanged++;
  }
  return NextResponse.json({ ok: true, moved, unchanged, needVideo });
}
