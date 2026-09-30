import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAgency, badRequest, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { cmCreators, cmPartnerships } from "@/lib/db/schema";
import { approve, pass, undoApproval, undoPass } from "@/lib/approvals";

/**
 * POST /api/partnerships/[id]/approval { decision: "approve"|"pass", note? } —
 * the agency approving or passing on the client's behalf. Recorded under the
 * teammate's name; passing closes the deal as We passed · Client passed.
 * { decision: "undo_approve", decidedAt } / { decision: "undo_pass",
 * transitionId } takes your own decision back within ten minutes.
 */
const undoSchema = z.union([
  z.object({ decision: z.literal("undo_approve"), decidedAt: z.string().max(40) }),
  z.object({ decision: z.literal("undo_pass"), transitionId: z.string().uuid() }),
]);
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAgency();
  if (error) return error;
  const { id } = await ctx.params;
  const scope = await assertPartnershipInSelectedClient(id);
  if (scope) return scope;
  const body = await req.json().catch(() => null);
  const undo = undoSchema.safeParse(body);
  const parsed = z.object({ decision: z.enum(["approve", "pass"]), note: z.string().max(500).optional() }).safeParse(body);
  if (!parsed.success && !undo.success) return badRequest("Choose approve or pass");
  const [row] = await db
    .select({ clientId: cmCreators.clientId })
    .from(cmPartnerships)
    .innerJoin(cmCreators, eq(cmCreators.id, cmPartnerships.creatorId))
    .where(eq(cmPartnerships.id, id))
    .limit(1);
  if (!row) return badRequest("Not found");
  const by = { name: session.user.name ?? "A teammate", kind: "agency" as const, userId: session.user.id };
  if (undo.success) {
    if (undo.data.decision === "undo_approve") {
      const r = await undoApproval(row.clientId, [id], by, undo.data.decidedAt);
      return r.undone ? NextResponse.json({ ok: true }) : badRequest("That approval can't be undone any more.");
    }
    const r = await undoPass(row.clientId, id, by, undo.data.transitionId);
    return r.ok ? NextResponse.json({ ok: true, stage: r.stage }) : badRequest(r.error);
  }
  if (!parsed.success) return badRequest("Choose approve or pass");
  if (parsed.data.decision === "approve") {
    const r = await approve(row.clientId, [id], by, parsed.data.note);
    return NextResponse.json({ ok: true, ...r });
  }
  const r = await pass(row.clientId, id, by, parsed.data.note);
  return r.ok ? NextResponse.json({ ok: true, transitionId: r.transitionId }) : badRequest("Couldn't pass on this creator");
}
