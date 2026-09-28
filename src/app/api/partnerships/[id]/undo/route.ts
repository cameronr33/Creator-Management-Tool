import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAgency, badRequest, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { undoMove } from "@/lib/email-status";
import { undoQuickAction } from "@/lib/quick-actions";
import { db } from "@/lib/db";
import { cmQuickActions, cmStageTransitions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const schema = z.union([z.object({ transitionId: z.string().uuid() }).strict(), z.object({ actionId: z.string().uuid() }).strict()]);

/**
 * POST /api/partnerships/[id]/undo — take back the latest move made from
 * email ({ transitionId }), or a quick button pressed in the last ten
 * minutes ({ actionId }: src/lib/quick-actions.ts decides what is allowed).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAgency();
  if (error) return error;
  const { id } = await ctx.params;
  const scope = await assertPartnershipInSelectedClient(id);
  if (scope) return scope;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid request");

  if ("actionId" in parsed.data) {
    const [a] = await db.select({ partnershipId: cmQuickActions.partnershipId }).from(cmQuickActions).where(eq(cmQuickActions.id, parsed.data.actionId)).limit(1);
    if (!a || a.partnershipId !== id) return badRequest("That isn't on this creator.");
    const r = await undoQuickAction(parsed.data.actionId, session.user.id);
    if (!r.ok) return badRequest(r.error);
    return NextResponse.json({ ok: true, stage: r.stage });
  }

  const [t] = await db.select({ partnershipId: cmStageTransitions.partnershipId }).from(cmStageTransitions).where(eq(cmStageTransitions.id, parsed.data.transitionId)).limit(1);
  if (!t || t.partnershipId !== id) return badRequest("That move isn't on this creator.");
  const r = await undoMove(parsed.data.transitionId, session.user.id);
  if (!r.ok) return badRequest(r.error);
  return NextResponse.json({ ok: true, stage: r.stage });
}
