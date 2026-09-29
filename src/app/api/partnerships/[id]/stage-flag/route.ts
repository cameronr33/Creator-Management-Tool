import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAgency, badRequest, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { answerStageFlag } from "@/lib/stage-flag-answer";
import { STAGE_VALUES } from "@/lib/stages";

const schema = z.object({
  action: z.enum(["move", "keep"]),
  /** The stage the page showed — the move only happens if it's still that. */
  expect: z.enum(STAGE_VALUES),
});

/**
 * POST /api/partnerships/[id]/stage-flag — answer "their emails read as
 * Talking, not Agreed": move them back (409 if someone moved it first), or
 * keep the stage (src/lib/stage-flag-answer.ts).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAgency();
  if (error) return error;
  const { id } = await ctx.params;
  const scope = await assertPartnershipInSelectedClient(id);
  if (scope) return scope;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid request");
  const r = await answerStageFlag(id, parsed.data.action, parsed.data.expect, session.user.id);
  if (!r.ok) return r.stale ? NextResponse.json({ ok: false, error: r.error }, { status: 409 }) : badRequest(r.error);
  return NextResponse.json({ ok: true, stage: r.stage });
}
