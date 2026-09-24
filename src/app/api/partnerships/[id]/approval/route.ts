import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAgency, badRequest, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { cmCreators, cmPartnerships } from "@/lib/db/schema";
import { approve, pass } from "@/lib/approvals";

/**
 * POST /api/partnerships/[id]/approval { decision: "approve"|"pass", note? } —
 * the agency approving or passing on the client's behalf. Recorded under the
 * teammate's name; passing closes the deal as We passed · Client passed.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAgency();
  if (error) return error;
  const { id } = await ctx.params;
  const scope = await assertPartnershipInSelectedClient(id);
  if (scope) return scope;
  const parsed = z.object({ decision: z.enum(["approve", "pass"]), note: z.string().max(500).optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Choose approve or pass");
  const [row] = await db
    .select({ clientId: cmCreators.clientId })
    .from(cmPartnerships)
    .innerJoin(cmCreators, eq(cmCreators.id, cmPartnerships.creatorId))
    .where(eq(cmPartnerships.id, id))
    .limit(1);
  if (!row) return badRequest("Not found");
  const by = { name: session.user.name ?? "A teammate", kind: "agency" as const, userId: session.user.id };
  if (parsed.data.decision === "approve") {
    const r = await approve(row.clientId, [id], by, parsed.data.note);
    return NextResponse.json({ ok: true, ...r });
  }
  const r = await pass(row.clientId, id, by, parsed.data.note);
  return r.ok ? NextResponse.json({ ok: true }) : badRequest("Couldn't pass on this creator");
}
