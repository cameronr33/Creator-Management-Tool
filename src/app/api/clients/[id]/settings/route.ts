import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAgency, badRequest } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { clients, cmClientSettings } from "@/lib/db/schema";
import { THRESHOLDS_SCHEMA } from "@/lib/thresholds";

/**
 * PATCH /api/clients/[id]/settings — this app's per-client knobs. Never
 * touches the shared sa_clients row.
 */
const thresholdsSchema = THRESHOLDS_SCHEMA;

const schema = z.object({
  hidden: z.boolean().optional(),
  /** null clears overrides back to DEFAULT_THRESHOLDS. */
  followUpThresholds: thresholdsSchema.nullable().optional(),
  /** New creators wait for the client's approval before outreach. */
  requiresApproval: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAgency();
  if (error) return error;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Couldn't save those settings. Check the values and try again.", parsed.error.flatten());
  const d = parsed.data;

  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, id)).limit(1);
  if (!client) return badRequest("That client isn't here any more. Reload the page.");

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (d.hidden !== undefined) set.hidden = d.hidden;
  if (d.followUpThresholds !== undefined) set.followUpThresholds = d.followUpThresholds;
  if (d.requiresApproval !== undefined) set.requiresApproval = d.requiresApproval;

  await db
    .insert(cmClientSettings)
    .values({
      clientId: id,
      hidden: d.hidden ?? false,
      followUpThresholds: d.followUpThresholds ?? null,
      requiresApproval: d.requiresApproval ?? false,
    })
    .onConflictDoUpdate({ target: cmClientSettings.clientId, set });

  return NextResponse.json({ ok: true });
}
