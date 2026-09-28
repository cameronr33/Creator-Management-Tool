import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmOutreachEvents, cmShipments, cmShipmentStatusEnum } from "@/lib/db/schema";
import { applyAutoStage, type AutoStageResult } from "@/lib/auto-stage";
import { recordQuickAction, snapshotShipment, type QuickUndo } from "@/lib/quick-actions";

/**
 * Recording a shipment — the one path for the agency (the shipment controls,
 * Today's Mark shipped) and the client portal (the brand ships it). Shipped
 * and delivered move the stage through the rule table, exactly as before;
 * when it's the client, who did it is kept with the move and noted on the
 * timeline ("Marked shipped by Rob Tinson · UPS 1Z…").
 *
 * When a teammate changes the status to shipped or delivered, the press is
 * recorded so it can be undone for ten minutes (src/lib/quick-actions.ts).
 * The portal's presses are never undoable from here.
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
): Promise<{ ok: true; stageChanged: AutoStageResult | null; undo: QuickUndo | null } | { ok: false; error: string }> {
  const now = new Date();
  // The shipment as it was. No id: adopt the partnership's existing shipment
  // (the latest, as moveStage does) rather than inserting a second one — this
  // is where the duplicate rows came from.
  const [before] = d.id
    ? await db.select().from(cmShipments).where(and(eq(cmShipments.id, d.id), eq(cmShipments.partnershipId, d.partnershipId))).limit(1)
    : await db.select().from(cmShipments).where(eq(cmShipments.partnershipId, d.partnershipId)).orderBy(desc(cmShipments.createdAt)).limit(1);
  if (d.id && !before) return { ok: false, error: "Shipment not found for this partnership" };

  // Stamp shippedAt / deliveredAt only when the status really changes to it and
  // no date was given: saving a tracking number the next day mustn't restart
  // "Shipped N days ago" (2026-09-28).
  const alreadyShipped = !!before?.shippedAt && (before.status === "shipped" || before.status === "delivered");
  const alreadyDelivered = !!before?.deliveredAt && before.status === "delivered";
  const shippedAt = d.shippedAt ? new Date(d.shippedAt) : d.status === "shipped" && !alreadyShipped ? now : undefined;
  const deliveredAt = d.deliveredAt ? new Date(d.deliveredAt) : d.status === "delivered" && !alreadyDelivered ? now : undefined;
  const update: Record<string, unknown> = { status: d.status, updatedAt: now };
  // Merge: a status-only click must never wipe the carrier/tracking/notes already on the row.
  for (const k of ["carrier", "trackingNumber", "notes"] as const) {
    if (d[k] !== undefined) update[k] = d[k];
  }
  if (shippedAt !== undefined) update.shippedAt = shippedAt;
  if (deliveredAt !== undefined) update.deliveredAt = deliveredAt;

  let shipmentId: string;
  if (before) {
    await db.update(cmShipments).set(update).where(eq(cmShipments.id, before.id));
    shipmentId = before.id;
  } else {
    const [created] = await db
      .insert(cmShipments)
      .values({
        partnershipId: d.partnershipId,
        status: d.status,
        carrier: d.carrier ?? null,
        trackingNumber: d.trackingNumber ?? null,
        ...(shippedAt !== undefined ? { shippedAt } : {}),
        ...(deliveredAt !== undefined ? { deliveredAt } : {}),
        notes: d.notes ?? null,
        updatedAt: now,
      })
      .returning({ id: cmShipments.id });
    shipmentId = created.id;
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

  // A teammate's press that changed the status to shipped or delivered: undoable.
  let undo: QuickUndo | null = null;
  if (actor.kind === "agency" && actor.userId && (d.status === "shipped" || d.status === "delivered") && before?.status !== d.status) {
    const [after] = await db.select().from(cmShipments).where(eq(cmShipments.id, shipmentId)).limit(1);
    if (after) {
      const actionId = await recordQuickAction({
        partnershipId: d.partnershipId,
        kind: "shipment",
        userId: actor.userId,
        shipmentId,
        transitionId: stageChanged?.transitionId ?? null,
        prior: before ? snapshotShipment(before) : null,
        applied: snapshotShipment(after),
        createdShipment: !before,
      });
      undo = { actionId, partnershipId: d.partnershipId };
    }
  }
  return { ok: true, stageChanged, undo };
}
