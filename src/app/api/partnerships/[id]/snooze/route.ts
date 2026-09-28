import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAgency, assertPartnershipInSelectedClient, badRequest } from "@/lib/api-helpers";
import { parseSnoozeUntil } from "@/lib/snooze-rules";
import { setSnooze } from "@/lib/snooze";

const schema = z.object({
  /** ISO time to hide it until, or null to bring it back now. */
  until: z.string().max(40).nullable(),
  reason: z.string().max(200).nullable().optional(),
});

/** POST /api/partnerships/[id]/snooze — off Today until a date (it wakes early if they write or the stage moves). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAgency();
  if (error) return error;
  const { id } = await ctx.params;
  const scope = await assertPartnershipInSelectedClient(id);
  if (scope) return scope;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid snooze", parsed.error.flatten());
  if (parsed.data.until === null) {
    await setSnooze(id, null, null, null);
    return NextResponse.json({ ok: true, until: null });
  }
  const when = parseSnoozeUntil(parsed.data.until);
  if (!when.ok) return badRequest(when.error);
  const ok = await setSnooze(id, when.until, parsed.data.reason ?? null, session.user.name ?? session.user.email ?? null);
  if (!ok) return badRequest("Creator not found");
  return NextResponse.json({ ok: true, until: when.until.toISOString() });
}
