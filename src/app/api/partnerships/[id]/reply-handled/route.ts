import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { requireAgency, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { cmPartnerships } from "@/lib/db/schema";

/** POST /api/partnerships/[id]/reply-handled — "No reply needed": off Today until they write again. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAgency();
  if (error) return error;
  const { id } = await ctx.params;
  const scope = await assertPartnershipInSelectedClient(id);
  if (scope) return scope;
  // Not an edit to the deal, so updatedAt stays put.
  await db.update(cmPartnerships).set({ replyHandledAt: new Date() }).where(eq(cmPartnerships.id, id));
  return NextResponse.json({ ok: true });
}
