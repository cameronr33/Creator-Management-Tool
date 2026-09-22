import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, badRequest, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { undoMove } from "@/lib/email-status";
import { db } from "@/lib/db";
import { cmStageTransitions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const schema = z.object({ transitionId: z.string().uuid() });

/** POST /api/partnerships/[id]/undo — take back the latest automatic move. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { id } = await ctx.params;
  const scope = await assertPartnershipInSelectedClient(id);
  if (scope) return scope;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid request");
  const [t] = await db.select({ partnershipId: cmStageTransitions.partnershipId }).from(cmStageTransitions).where(eq(cmStageTransitions.id, parsed.data.transitionId)).limit(1);
  if (!t || t.partnershipId !== id) return badRequest("That move isn't on this creator.");
  const r = await undoMove(parsed.data.transitionId, session.user.id);
  if (!r.ok) return badRequest(r.error);
  return NextResponse.json({ ok: true, stage: r.stage });
}
