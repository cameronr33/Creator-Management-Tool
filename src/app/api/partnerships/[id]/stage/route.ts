import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAgency, badRequest, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { changeStage } from "@/lib/mutations";
import { cmExitReasonEnum } from "@/lib/db/schema";
import { STAGE_VALUES } from "@/lib/stages";
import { httpUrl } from "@/lib/validation";

const schema = z.object({
  // Current stages only: a stale tab offering a retired stage gets a 400.
  stage: z.enum(STAGE_VALUES),
  /** Optional, meaningful for the three closed stages: why it ended, recorded in the same step. */
  exitReason: z.enum(cmExitReasonEnum.enumValues).nullable().optional(),
  /** Required when moving to Posted and no video is recorded yet. */
  videoUrl: httpUrl.nullable().optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAgency();
  if (error) return error;

  const { id } = await ctx.params;
  const scope = await assertPartnershipInSelectedClient(id);
  if (scope) return scope;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("That stage no longer exists — reload the page and pick again.", parsed.error.flatten());

  const result = await changeStage(id, parsed.data.stage, session.user.id, {
    exitReason: parsed.data.exitReason,
    videoUrl: parsed.data.videoUrl ?? null,
  });
  if (result.status === "needs_video") {
    return badRequest("Add the posted video's link to move them to Posted.", { needsVideo: true });
  }
  if (result.status === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (result.status === "stale") {
    return NextResponse.json({ error: "Someone else just moved this creator — reload to see where they are." }, { status: 409 });
  }
  const stage = result.status === "moved" ? result.to : result.stage;
  return NextResponse.json({
    ok: true,
    stage,
    // useSave announces automatic continuations ("Agreed → Shipping", because
    // their address is already on file) like any other automatic move.
    stageChanged: result.status === "moved" && result.continued ? { from: parsed.data.stage, to: result.to } : null,
  });
}
