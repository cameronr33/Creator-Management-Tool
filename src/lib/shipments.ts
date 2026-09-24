import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmOutreachEvents, cmShipments, cmShipmentStatusEnum } from "@/lib/db/schema";
import { applyAutoStage, type AutoStageResult } from "@/lib/auto-stage";

/**
 * Recording a shipment — the one path for the agency (the shipment controls,
 * Today's Mark shipped) and the client portal (the brand ships it). Shipped
 * and delivered move the stage through the rule table, exactly as before;
 * when it's the client, who did it is kept with the move and noted on the
 * timeline ("Marked shipped by Rob Tinson · UPS 1Z…").
 */

export type ShipmentStatus = (typeof cmShipmentStatusEnum.enumValues)[number];

export interface ShipmentInput {
  id?: string;
  partnershipId: string;
  status: ShipmentStatus;
  carrier?: string | null;
  trackingNumber?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  notes?: string | null;
}

/** Pure: the client may mark shipped only from Ready to ship, and delivered only once it's on its way. */
export function clientMayShip(stage: string, status: "shipped" | "delivered"): boolean {
  return status === "shipped" ? stage === "fulfilling" : stage === "shipped";
}

export type ShipmentActor = { kind: "agency"; userId: string | null } | { kind: "client"; id: string; name: string };

export async function recordShipment(
  d: ShipmentInput,
  actor: ShipmentActor,
): Promise<{ ok: true; stageChanged: AutoStageResult | null } | { ok: false; error: string }> {
  // Auto-stamp shippedAt/deliveredAt when the status advances and no explicit date was supplied.
  const now = new Date();
  const shippedAt = d.shippedAt ? new Date(d.shippedAt) : d.status === "shipped" ? now : undefined;
  const deliveredAt = d.deliveredAt ? new Date(d.deliveredAt) : d.status === "delivered" ? now : undefined;
  const update: Record<string, unknown> = { status: d.status, updatedAt: now };
  // Merge: a status-only click must never wipe the carrier/tracking/notes already on the row.
  for (const k of ["carrier", "trackingNumber", "notes"] as const) {
    if (d[k] !== undefined) update[k] = d[k];
  }
  if (shippedAt !== undefined) update.shippedAt = shippedAt;
  if (deliveredAt !== undefined) update.deliveredAt = deliveredAt;

  if (d.id) {
    const updated = await db
      .update(cmShipments)
      .set(update)
      .where(and(eq(cmShipments.id, d.id), eq(cmShipments.partnershipId, d.partnershipId)))
      .returning({ id: cmShipments.id });
    if (updated.length === 0) return { ok: false, error: "Shipment not found for this partnership" };
  } else {
    // No id: adopt the partnership's existing shipment rather than inserting a
    // second one — this is where the duplicate rows came from.
    const [existing] = await db.select({ id: cmShipments.id }).from(cmShipments).where(eq(cmShipments.partnershipId, d.partnershipId)).limit(1);
    if (existing) {
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

  const meta = actor.kind === "client" ? { byClient: actor.name, clientUserId: actor.id } : undefined;
  if (actor.kind === "client" && (d.status === "shipped" || d.status === "delivered")) {
    const tracking = [d.carrier, d.trackingNumber].filter(Boolean).join(" ");
    await db.insert(cmOutreachEvents).values({
      partnershipId: d.partnershipId,
      direction: "outbound",
      channel: "other",
      kind: "note",
      body: `Marked ${d.status} by ${actor.name}${tracking ? ` · ${tracking}` : ""}`,
    });
  }
  // A shipped/delivered package unambiguously advances the pipeline.
  const userId = actor.kind === "agency" ? actor.userId ?? undefined : undefined;
  const stageChanged =
    d.status === "shipped"
      ? await applyAutoStage(d.partnershipId, "shipment_shipped", userId, { meta })
      : d.status === "delivered"
        ? await applyAutoStage(d.partnershipId, "shipment_delivered", userId, { meta })
        : null;
  return { ok: true, stageChanged };
}
