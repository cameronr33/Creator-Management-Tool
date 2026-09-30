import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAgency, badRequest, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { parseRemindOn } from "@/lib/archive-rules";
import { restoreArchived, setArchived } from "@/lib/archive";

const schema = z.object({
  archived: z.boolean(),
  /** The optional "remind me on" date. */
  until: z.string().max(40).nullable().optional(),
  reason: z.string().max(200).nullable().optional(),
});

/**
 * POST /api/partnerships/[id]/archive — off Today, the Pipeline and the
 * Creators list (they come back if they write or the stage moves), or back.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAgency();
  if (error) return error;
  const { id } = await ctx.params;
  const scope = await assertPartnershipInSelectedClient(id);
  if (scope) return scope;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Couldn't save that. Reload the page and try again.", parsed.error.flatten());
  if (!parsed.data.archived) {
    await restoreArchived([id]);
    return NextResponse.json({ ok: true });
  }
  const when = parseRemindOn(parsed.data.until);
  if (!when.ok) return badRequest(when.error);
  const done = await setArchived([id], { until: when.until, reason: parsed.data.reason ?? null, byName: session.user.name ?? session.user.email ?? null });
  if (!done) return badRequest("That creator isn't here any more");
  return NextResponse.json({ ok: true, until: when.until?.toISOString() ?? null });
}
