import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth, badRequest } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { clients, cmClientSettings } from "@/lib/db/schema";

/**
 * PATCH /api/clients/[id]/settings — this app's per-client knobs. Never
 * touches the shared sa_clients row.
 */
const thresholdsSchema = z
  .object({
    initialOutreachAfterDays: z.number().int().min(0).max(365).optional(),
    followUp1AfterDays: z.number().int().min(1).max(365).optional(),
    followUp2AfterDays: z.number().int().min(1).max(365).optional(),
    markNoResponseAfterDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();

const schema = z.object({
  hidden: z.boolean().optional(),
  /** null clears overrides back to DEFAULT_THRESHOLDS. */
  followUpThresholds: thresholdsSchema.nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid settings", parsed.error.flatten());
  const d = parsed.data;

  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, id)).limit(1);
  if (!client) return badRequest("Client not found");

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (d.hidden !== undefined) set.hidden = d.hidden;
  if (d.followUpThresholds !== undefined) set.followUpThresholds = d.followUpThresholds;

  await db
    .insert(cmClientSettings)
    .values({
      clientId: id,
      hidden: d.hidden ?? false,
      followUpThresholds: d.followUpThresholds ?? null,
    })
    .onConflictDoUpdate({ target: cmClientSettings.clientId, set });

  return NextResponse.json({ ok: true });
}
