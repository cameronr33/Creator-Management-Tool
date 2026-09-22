import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { cmPartnerships } from "@/lib/db/schema";

/** POST /api/partnerships/[id]/reply-handled — "No reply needed": off Today until they write again. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;
  const { id } = await ctx.params;
  const scope = await assertPartnershipInSelectedClient(id);
  if (scope) return scope;
  await db.update(cmPartnerships).set({ replyHandledAt: new Date(), updatedAt: new Date() }).where(eq(cmPartnerships.id, id));
  return NextResponse.json({ ok: true });
}
