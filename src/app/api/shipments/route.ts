import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireAuth, badRequest, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { isoDate } from "@/lib/validation";
import { applyAutoStage } from "@/lib/auto-stage";
import { db } from "@/lib/db";
import { cmShipments, cmShipmentStatusEnum } from "@/lib/db/schema";

const schema = z.object({
  id: z.string().uuid().optional(),
  partnershipId: z.string().uuid(),
  status: z.enum(cmShipmentStatusEnum.enumValues),
  carrier: z.string().nullable().optional(),
  trackingNumber: z.string().nullable().optional(),
  shippedAt: isoDate.nullable().optional(),
  deliveredAt: isoDate.nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid shipment", parsed.error.flatten());
  const d = parsed.data;

  const scope = await assertPartnershipInSelectedClient(d.partnershipId);
  if (scope) return scope;

  // Auto-stamp shippedAt/deliveredAt when the status advances and no explicit
  // date was supplied.
  const now = new Date();
  const shippedAt = d.shippedAt ? new Date(d.shippedAt) : d.status === "shipped" ? now : undefined;
  const deliveredAt = d.deliveredAt ? new Date(d.deliveredAt) : d.status === "delivered" ? now : undefined;

  if (d.id) {
    // Merge: a status-only click (dashboard "Mark shipped") must never wipe
    // the carrier/tracking/notes already on the row.
    const update: Record<string, unknown> = { status: d.status, updatedAt: now };
    for (const k of ["carrier", "trackingNumber", "notes"] as const) {
      if (d[k] !== undefined) update[k] = d[k];
    }
    if (shippedAt !== undefined) update.shippedAt = shippedAt;
    if (deliveredAt !== undefined) update.deliveredAt = deliveredAt;
    const updated = await db
      .update(cmShipments)
      .set(update)
      .where(and(eq(cmShipments.id, d.id), eq(cmShipments.partnershipId, d.partnershipId)))
      .returning({ id: cmShipments.id });
    if (updated.length === 0) return badRequest("Shipment not found for this partnership");
  } else {
    // No id supplied. The client may simply not have one yet (a blur-save
    // racing the first status click), so adopt the partnership's existing
    // shipment rather than inserting a second one — this is where the
    // duplicate rows came from.
    const [existing] = await db
      .select({ id: cmShipments.id })
      .from(cmShipments)
      .where(eq(cmShipments.partnershipId, d.partnershipId))
      .limit(1);

    if (existing) {
      const update: Record<string, unknown> = { status: d.status, updatedAt: now };
      for (const k of ["carrier", "trackingNumber", "notes"] as const) {
        if (d[k] !== undefined) update[k] = d[k];
      }
      if (shippedAt !== undefined) update.shippedAt = shippedAt;
      if (deliveredAt !== undefined) update.deliveredAt = deliveredAt;
      await db.update(cmShipments).set(update).where(eq(cmShipments.id, existing.id));
    } else {
      await db.insert(cmShipments).values({
        partnershipId: d.partnershipId,
        status: d.status,
        carrier: d.carrier ?? null,
        trackingNumber: d.trackingNumber ?? null,
        ...(shippedAt !== undefined ? { shippedAt } : {}),
        ...(deliveredAt !== undefined ? { deliveredAt } : {}),
        notes: d.notes ?? null,
        updatedAt: now,
      });
    }
  }

  // A shipped/delivered package unambiguously advances the pipeline.
  const stageChanged =
    d.status === "shipped"
      ? await applyAutoStage(d.partnershipId, "shipment_shipped", session.user.id)
      : d.status === "delivered"
        ? await applyAutoStage(d.partnershipId, "shipment_delivered", session.user.id)
        : null;

  return NextResponse.json({ ok: true, stageChanged });
}
