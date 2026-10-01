import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAgency, badRequest, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { markPromiseDone, undoPromiseDone } from "@/lib/promise-answer";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("done") }),
  /** The moment "done" returned — Undo only while it's still that. */
  z.object({ action: z.literal("undo"), doneAt: z.string().datetime() }),
]);

/**
 * POST /api/partnerships/[id]/promise — "We said we'd get back to them":
 * mark our side's open promise done, or Undo that (src/lib/promise-answer.ts).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAgency();
  if (error) return error;
  const { id } = await ctx.params;
  const scope = await assertPartnershipInSelectedClient(id);
  if (scope) return scope;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Couldn't save that. Reload the page and try again.");
  if (parsed.data.action === "undo") {
    if (!(await undoPromiseDone(id, new Date(parsed.data.doneAt)))) return badRequest("That can't be undone from here any more. Reload the page.");
    return NextResponse.json({ ok: true });
  }
  const doneAt = await markPromiseDone(id);
  if (!doneAt) return badRequest("There's no open promise on this creator any more. Reload the page.");
  return NextResponse.json({ ok: true, doneAt: doneAt.toISOString() });
}
