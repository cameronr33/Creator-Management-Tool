import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth, badRequest } from "@/lib/api-helpers";
import { applyAutoStage } from "@/lib/auto-stage";
import { db } from "@/lib/db";
import { cmShipments, cmShipmentStatusEnum } from "@/lib/db/schema";

const schema = z.object({
  id: z.string().uuid().optional(),
  partnershipId: z.string().uuid(),
  status: z.enum(cmShipmentStatusEnum.enumValues),
  carrier: z.string().nullable().optional(),
  trackingNumber: z.string().nullable().optional(),
  shippedAt: z.string().nullable().optional(),
  deliveredAt: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid shipment", parsed.error.flatten());
  const d = parsed.data;

  // Auto-stamp shippedAt/deliveredAt when the status advances and no explicit
  // date was supplied.
  const now = new Date();
  const shippedAt = d.shippedAt ? new Date(d.shippedAt) : d.status === "shipped" ? now : undefined;
  const deliveredAt = d.deliveredAt ? new Date(d.deliveredAt) : d.status === "delivered" ? now : undefined;

  const values = {
    partnershipId: d.partnershipId,
    status: d.status,
    carrier: d.carrier ?? null,
    trackingNumber: d.trackingNumber ?? null,
    ...(shippedAt !== undefined ? { shippedAt } : {}),
    ...(deliveredAt !== undefined ? { deliveredAt } : {}),
    notes: d.notes ?? null,
    updatedAt: now,
  };

  if (d.id) {
    await db.update(cmShipments).set(values).where(eq(cmShipments.id, d.id));
  } else {
    await db.insert(cmShipments).values(values);
  }

  // A shipped/delivered package unambiguously advances the pipeline.
  const stageChanged =
    d.status === "shipped"
      ? await applyAutoStage(d.partnershipId, "shipment_shipped")
      : d.status === "delivered"
        ? await applyAutoStage(d.partnershipId, "shipment_delivered")
        : null;

  return NextResponse.json({ ok: true, stageChanged });
}
