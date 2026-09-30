import { NextResponse, type NextRequest } from "next/server";
import { requireAgency, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { assessPartnership } from "@/lib/email-status";

/** POST /api/partnerships/[id]/assess — "Re-read emails": read this conversation now. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAgency();
  if (error) return error;
  const { id } = await ctx.params;
  const scope = await assertPartnershipInSelectedClient(id);
  if (scope) return scope;
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, error: "Email reading isn't set up on this server." }, { status: 400 });
  }
  try {
    const o = await assessPartnership(id, { apply: true });
    if (o.skipped) {
      // The reason is for the server log; a teammate gets what to do (interface review R3).
      console.warn(`[assess] ${id} skipped: ${o.skipped}`);
      return NextResponse.json({ ok: false, error: "Couldn't read these emails right now. Try Re-read emails again in a minute." }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      summary: o.assessment?.summary ?? null,
      stageChanged: o.moved ? { from: o.moved.from, to: o.moved.to } : null,
    });
  } catch (err) {
    console.error(`[assess] ${id}`, err);
    return NextResponse.json({ ok: false, error: "Couldn't read these emails right now. Try Re-read emails again in a minute." }, { status: 500 });
  }
}
