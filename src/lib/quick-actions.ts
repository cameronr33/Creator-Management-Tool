import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cmOutreachEvents,
  cmPartnerships,
  cmQuickActions,
  cmShipments,
  cmStageTransitions,
  type CmShipment,
  type CmStage,
} from "@/lib/db/schema";
import { moveStage, type ExitReason } from "@/lib/stage-moves";
import { isTerminal, stageIndex } from "@/lib/stages";

/**
 * Undo for the quick buttons — I messaged them, They replied, Mark shipped,
 * Mark delivered, and the log panel (owner, 2026-09-28: "Undo on quick
 * buttons"). Each press writes a cm_quick_actions row saying what it did, so
 * the server reverses exactly that and never trusts the browser.
 *
 * Undo is allowed only for the teammate who pressed it, within ten minutes,
 * once; never for mail the mailbox holds; never once the shipment has been
 * changed since; and only while the stage move the press caused is still the
 * latest real move. The stage goes back through moveStage (a person's move,
 * reason "undo", compare-and-set on the stage), so a race writes nothing. A
 * retried or doubled request finds the undo it already wrote and finishes
 * the same way. Tested in scripts/verify-undo.ts.
 */

export const UNDO_WINDOW_MS = 10 * 60_000;

export type QuickActionKind = "message" | "shipment";

/** What the API hands back after a press, for the toast's Undo. */
export type QuickUndo = { actionId: string; partnershipId: string };

/** A shipment as it was — what Undo puts back, and how it tells nobody touched it since. */
export interface ShipmentSnapshot {
  status: CmShipment["status"];
  carrier: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  notes: string | null;
  updatedAt: string;
}

export function snapshotShipment(s: Pick<CmShipment, "status" | "carrier" | "trackingNumber" | "shippedAt" | "deliveredAt" | "notes" | "updatedAt">): ShipmentSnapshot {
  return {
    status: s.status,
    carrier: s.carrier,
    trackingNumber: s.trackingNumber,
    shippedAt: s.shippedAt?.toISOString() ?? null,
    deliveredAt: s.deliveredAt?.toISOString() ?? null,
    notes: s.notes,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function recordQuickAction(input: {
  partnershipId: string;
  kind: QuickActionKind;
  userId: string | null;
  outreachEventId?: string | null;
  shipmentId?: string | null;
  transitionId?: string | null;
  prior?: ShipmentSnapshot | null;
  applied?: ShipmentSnapshot | null;
  createdShipment?: boolean;
}): Promise<string> {
  const [row] = await db
    .insert(cmQuickActions)
    .values({
      partnershipId: input.partnershipId,
      kind: input.kind,
      createdBy: input.userId,
      outreachEventId: input.outreachEventId ?? null,
      shipmentId: input.shipmentId ?? null,
      transitionId: input.transitionId ?? null,
      prior: input.prior ?? null,
      applied: input.applied ?? null,
      createdShipment: input.createdShipment ?? false,
    })
    .returning({ id: cmQuickActions.id });
  return row.id;
}

/* ── The rules (pure) ───────────────────────────────────────────── */

export const UNDO_MESSAGES = {
  gone: "There's nothing to undo.",
  already: "That was already undone.",
  notYours: "Only the teammate who pressed it can undo it — change it by hand instead.",
  tooLate: "Too late to undo — change it by hand.",
  synced: "That message came in through the mailbox — it can't be undone here.",
  stageMoved: "The stage has moved since — change it by hand.",
  shipmentChanged: "The shipment was changed since — fix it under Shipping.",
} as const;

export interface QuickActionFacts {
  kind: QuickActionKind;
  createdBy: string | null;
  createdAt: Date;
  undoneAt: Date | null;
  outreachEventId: string | null;
  transitionId: string | null;
  shipmentId: string | null;
  prior: ShipmentSnapshot | null;
  applied: ShipmentSnapshot | null;
  createdShipment: boolean;
}

export interface UndoState {
  userId: string;
  now: Date;
  /** The message it logged, as it is now (null when it's gone). */
  event: { externalId: string | null } | null;
  /** The move the press caused, as it is now. */
  transition: { id: string; fromStage: CmStage | null; toStage: CmStage; undoneAt: Date | null; meta: unknown } | null;
  /** The partnership's latest move that isn't undone and isn't itself an undo. */
  latestRealMoveId: string | null;
  stage: CmStage;
  /** An earlier (retried or doubled) request already moved the stage back. */
  alreadyMovedBack: boolean;
  /** The shipment as it is now (null when it's gone). */
  shipment: ShipmentSnapshot | null;
}

export type UndoPlan =
  | {
      ok: true;
      /** Put the stage back: from where the press left it to where it was, with the exit reason it had. */
      moveBack: { from: CmStage; to: CmStage; exitReason: ExitReason | undefined } | null;
      /** Where the stage ends up (null: the press never moved it). */
      backTo: CmStage | null;
      deleteEvent: boolean;
      /** Put the shipment's status and dates back (carrier, tracking and notes are kept). */
      restoreShipment: boolean;
    }
  | { ok: false; error: string };

const sameState = (a: ShipmentSnapshot, b: Pick<ShipmentSnapshot, "status" | "shippedAt" | "deliveredAt">) =>
  a.status === b.status && a.shippedAt === b.shippedAt && a.deliveredAt === b.deliveredAt;

export function planQuickUndo(a: QuickActionFacts, s: UndoState): UndoPlan {
  if (a.undoneAt) return { ok: false, error: UNDO_MESSAGES.already };
  if (!a.createdBy || a.createdBy !== s.userId) return { ok: false, error: UNDO_MESSAGES.notYours };
  if (s.now.getTime() - a.createdAt.getTime() > UNDO_WINDOW_MS) return { ok: false, error: UNDO_MESSAGES.tooLate };

  let deleteEvent = false;
  if (a.kind === "message" && a.outreachEventId && s.event) {
    // Only a message logged in the app is ours to remove; mail the mailbox holds never is.
    if (s.event.externalId !== null) return { ok: false, error: UNDO_MESSAGES.synced };
    deleteEvent = true;
  }

  let moveBack: { from: CmStage; to: CmStage; exitReason: ExitReason | undefined } | null = null;
  let backTo: CmStage | null = null;
  if (a.transitionId) {
    const t = s.transition;
    if (s.alreadyMovedBack) {
      backTo = t?.fromStage ?? null;
    } else {
      if (!t || t.undoneAt || !t.fromStage || s.latestRealMoveId !== t.id || s.stage !== t.toStage) return { ok: false, error: UNDO_MESSAGES.stageMoved };
      const prior = (t.meta as { priorExitReason?: ExitReason } | null)?.priorExitReason;
      moveBack = { from: t.toStage, to: t.fromStage, exitReason: prior ?? undefined };
      backTo = t.fromStage;
    }
  }

  let restoreShipment = false;
  if (a.kind === "shipment") {
    const now = s.shipment;
    const target = a.prior ?? { status: "ready" as const, shippedAt: null, deliveredAt: null };
    if (now && sameState(now, target)) restoreShipment = false; // already back (a retried request)
    else if (s.alreadyMovedBack) restoreShipment = !!now; // finishing an undo that already moved the stage back
    else if (!now || !a.applied || now.updatedAt !== a.applied.updatedAt) return { ok: false, error: UNDO_MESSAGES.shipmentChanged };
    else restoreShipment = true;
  }

  return { ok: true, moveBack, backTo, deleteEvent, restoreShipment };
}

/* ── Doing it ───────────────────────────────────────────────────── */

async function undoWrittenFor(partnershipId: string, actionId: string): Promise<boolean> {
  const [u] = await db
    .select({ id: cmStageTransitions.id })
    .from(cmStageTransitions)
    .where(and(eq(cmStageTransitions.partnershipId, partnershipId), eq(cmStageTransitions.reason, "undo"), sql`${cmStageTransitions.meta}->>'quickActionId' = ${actionId}`))
    .limit(1);
  return !!u;
}

export type UndoResult = { ok: true; stage: CmStage | null } | { ok: false; error: string };

export async function undoQuickAction(actionId: string, userId: string, now = new Date()): Promise<UndoResult> {
  const [a] = await db.select().from(cmQuickActions).where(eq(cmQuickActions.id, actionId)).limit(1);
  if (!a) return { ok: false, error: UNDO_MESSAGES.gone };
  const facts: QuickActionFacts = { ...a, prior: a.prior as ShipmentSnapshot | null, applied: a.applied as ShipmentSnapshot | null };

  const [[p], [event], [transition], [latest], [shipment], movedBack] = await Promise.all([
    db.select({ stage: cmPartnerships.stage }).from(cmPartnerships).where(eq(cmPartnerships.id, a.partnershipId)).limit(1),
    a.outreachEventId
      ? db.select({ externalId: cmOutreachEvents.externalId }).from(cmOutreachEvents).where(eq(cmOutreachEvents.id, a.outreachEventId)).limit(1)
      : Promise.resolve([]),
    a.transitionId ? db.select().from(cmStageTransitions).where(eq(cmStageTransitions.id, a.transitionId)).limit(1) : Promise.resolve([]),
    db
      .select({ id: cmStageTransitions.id })
      .from(cmStageTransitions)
      .where(
        and(
          eq(cmStageTransitions.partnershipId, a.partnershipId),
          isNull(cmStageTransitions.undoneAt),
          or(isNull(cmStageTransitions.reason), ne(cmStageTransitions.reason, "undo")),
        ),
      )
      .orderBy(desc(cmStageTransitions.changedAt))
      .limit(1),
    a.shipmentId ? db.select().from(cmShipments).where(eq(cmShipments.id, a.shipmentId)).limit(1) : Promise.resolve([]),
    undoWrittenFor(a.partnershipId, a.id),
  ]);
  if (!p) return { ok: false, error: UNDO_MESSAGES.gone };

  const plan = planQuickUndo(facts, {
    userId,
    now,
    event: event ?? null,
    transition: transition ?? null,
    latestRealMoveId: latest?.id ?? null,
    stage: p.stage,
    alreadyMovedBack: movedBack,
    shipment: shipment ? snapshotShipment(shipment) : null,
  });
  if (!plan.ok) return plan;

  // 1. The stage, first: if someone moved it meanwhile, nothing below is written.
  if (plan.moveBack) {
    const r = await moveStage({
      partnershipId: a.partnershipId,
      to: plan.moveBack.to,
      source: "manual",
      userId,
      expectFrom: plan.moveBack.from,
      exact: true,
      reason: "undo",
      exitReason: plan.moveBack.exitReason,
      meta: { undoOf: a.transitionId, quickActionId: a.id },
    });
    // A doubled click: the other request got there first — finish the same way.
    if (r.status !== "moved" && !(await undoWrittenFor(a.partnershipId, a.id))) return { ok: false, error: UNDO_MESSAGES.stageMoved };
  }

  // 2. The shipment: its status and dates as they were (carrier, tracking and notes stay).
  if (a.kind === "shipment" && a.shipmentId && (plan.restoreShipment || a.createdShipment)) {
    const [s] = await db.select().from(cmShipments).where(eq(cmShipments.id, a.shipmentId)).limit(1);
    const [after] = await db.select({ stage: cmPartnerships.stage }).from(cmPartnerships).where(eq(cmPartnerships.id, a.partnershipId)).limit(1);
    const beforeReady = !!after && !isTerminal(after.stage) && stageIndex(after.stage) < stageIndex("fulfilling");
    if (s && a.createdShipment && beforeReady && !s.carrier && !s.trackingNumber) {
      // The press created it and the stage no longer needs one: it goes, as it came.
      await db.delete(cmShipments).where(eq(cmShipments.id, s.id));
    } else if (s && plan.restoreShipment) {
      const prior = facts.prior;
      await db
        .update(cmShipments)
        .set({
          status: prior?.status ?? "ready",
          shippedAt: prior?.shippedAt ? new Date(prior.shippedAt) : null,
          deliveredAt: prior?.deliveredAt ? new Date(prior.deliveredAt) : null,
          updatedAt: new Date(),
        })
        .where(eq(cmShipments.id, s.id));
    }
  }

  // 3. The message it logged — only ever one logged in the app.
  if (plan.deleteEvent && a.outreachEventId) {
    await db.delete(cmOutreachEvents).where(and(eq(cmOutreachEvents.id, a.outreachEventId), isNull(cmOutreachEvents.externalId)));
  }

  // 4. Marked undone last, so a request that stopped halfway can be finished by pressing again.
  if (a.transitionId) await db.update(cmStageTransitions).set({ undoneAt: now }).where(and(eq(cmStageTransitions.id, a.transitionId), isNull(cmStageTransitions.undoneAt)));
  await db.update(cmQuickActions).set({ undoneAt: now }).where(and(eq(cmQuickActions.id, a.id), isNull(cmQuickActions.undoneAt)));
  return { ok: true, stage: plan.backTo };
}
