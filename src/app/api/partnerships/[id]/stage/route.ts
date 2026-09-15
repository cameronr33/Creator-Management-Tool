import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, badRequest, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { changeStage } from "@/lib/mutations";
import { cmStageEnum, cmExitReasonEnum } from "@/lib/db/schema";

const schema = z.object({
  stage: z.enum(cmStageEnum.enumValues),
  /** Optional, meaningful for the three closed stages: why it ended, recorded in the same step. */
  exitReason: z.enum(cmExitReasonEnum.enumValues).nullable().optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await ctx.params;
  const scope = await assertPartnershipInSelectedClient(id);
  if (scope) return scope;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid stage", parsed.error.flatten());

  await changeStage(id, parsed.data.stage, session.user.id, {
    exitReason: parsed.data.exitReason,
  });
  return NextResponse.json({ ok: true });
}
