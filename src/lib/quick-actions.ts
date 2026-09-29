import { and, desc, eq, isNull, ne, or, sql, type SQL } from "drizzle-orm";
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
import type { ExitReason } from "@/lib/stage-moves";
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
 * latest real move. The reversal is ONE statement (review, 2026-09-28): the
 * stage back (a person's move, reason "undo"), the shipment the press touched
 * put back, the logged message removed, and both marked undone — all of it or
 * none, each guarded by a compare-and-set, so a race or a dropped connection
 * can't leave half an undo. Only the rows the press touched are changed —
 * the pressed shipment, and a second one its own move to Shipped marked
 * (`markedShippedId`) — never "the latest shipment" by side effect. Rows
 * are locked partnership first, like every stage move, so it can't deadlock
 * with one. Tested in scripts/verify-undo.ts.
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
  transition: { id: string; fromStage: CmStage | null; toStage: CmStage; undoneAt: Date | null; meta: unknown; changedAt: Date } | null;
  /** The partnership's latest move that isn't undone and isn't itself an undo. */
  latestRealMoveId: string | null;
  stage: CmStage;
  /** The shipment as it is now (null when it's gone). */
  shipment: ShipmentSnapshot | null;
}

export type ShipmentUndo =
  | { mode: "restore"; expect: ShipmentState; to: ShipmentState }
  /** The press created it and the stage no longer needs one (and nobody added tracking): it goes, as it came. */
  | { mode: "delete"; expect: ShipmentState };

export interface ShipmentState {
  status: CmShipment["status"];
  shippedAt: string | null;
  deliveredAt: string | null;
}

export type UndoPlan =
  | {
      ok: true;
      /** Put the stage back: from where the press left it to where it was, with the exit reason it had. */
      moveBack: { from: CmStage; to: CmStage; exitReason: ExitReason | null } | null;
      /** Where the stage ends up (null: the press never moved it). */
      backTo: CmStage | null;
      deleteEvent: boolean;
      /** What happens to the shipment the press touched (carrier, tracking and notes are always kept). */
      shipment: ShipmentUndo | null;
      /** Another shipment the press's own move to Shipped marked shipped, put back to not sent yet if nobody touched it since. */
      alsoUnmark: { id: string; markedAt: string } | null;
      /** The stage everything above was decided on — the write goes ahead only while it still is. */
      stageNow: CmStage;
    }
  | { ok: false; error: string };

const stateOf = (s: Pick<ShipmentSnapshot, "status" | "shippedAt" | "deliveredAt">): ShipmentState => ({ status: s.status, shippedAt: s.shippedAt, deliveredAt: s.deliveredAt });

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

  let moveBack: { from: CmStage; to: CmStage; exitReason: ExitReason | null } | null = null;
  let backTo: CmStage | null = null;
  let alsoUnmark: { id: string; markedAt: string } | null = null;
  if (a.transitionId) {
    const t = s.transition;
    if (!t || t.undoneAt || !t.fromStage || s.latestRealMoveId !== t.id || s.stage !== t.toStage) return { ok: false, error: UNDO_MESSAGES.stageMoved };
    const meta = (t.meta ?? {}) as { priorExitReason?: ExitReason; markedShippedId?: string };
    // Back to a closed stage brings its reason back ("Stopped replying"); an open one has none.
    moveBack = { from: t.toStage, to: t.fromStage, exitReason: isTerminal(t.fromStage) ? (meta.priorExitReason ?? null) : null };
    backTo = t.fromStage;
    // The move to Shipped also marked "the latest shipment" shipped when it wasn't the pressed one.
    if (a.kind === "shipment" && meta.markedShippedId && meta.markedShippedId !== a.shipmentId) alsoUnmark = { id: meta.markedShippedId, markedAt: t.changedAt.toISOString() };
  }

  let shipment: ShipmentUndo | null = null;
  if (a.kind === "shipment") {
    const now = s.shipment;
    if (!now || !a.applied || now.updatedAt !== a.applied.updatedAt) return { ok: false, error: UNDO_MESSAGES.shipmentChanged };
    const landing = backTo ?? s.stage;
    const beforeReady = !isTerminal(landing) && stageIndex(landing) < stageIndex("fulfilling");
    shipment =
      a.createdShipment && beforeReady && !now.carrier && !now.trackingNumber
        ? { mode: "delete", expect: stateOf(a.applied) }
        : { mode: "restore", expect: stateOf(a.applied), to: a.prior ? stateOf(a.prior) : { status: "ready", shippedAt: null, deliveredAt: null } };
  }

  return { ok: true, moveBack, backTo, deleteEvent, shipment, alsoUnmark, stageNow: s.stage };
}

/* ── Doing it: one statement ────────────────────────────────────── */

/** Same moment to the millisecond (a JS Date holds milliseconds; the column holds microseconds). */
function sameTime(column: SQL, iso: string | null): SQL {
  return iso === null ? sql`${column} is null` : sql`(${column} is not null and abs(extract(epoch from (${column} - ${iso}::timestamp))) < 0.001)`;
}

async function writeUndo(
  a: { id: string; partnershipId: string; transitionId: string | null; outreachEventId: string | null; shipmentId: string | null },
  plan: Extract<UndoPlan, { ok: true }>,
  applied: ShipmentSnapshot | null,
  userId: string,
): Promise<boolean> {
  const move = plan.moveBack;
  const ship = a.shipmentId ? plan.shipment : null;
  const hasShipment = !!ship;
  const deleting = ship?.mode === "delete";
  const restoring = ship?.mode === "restore";
  const to = ship?.mode === "restore" ? ship.to : null;
  // Exactly as the press left it — updated_at included, so a tracking number saved since counts as a change.
  const expected = ship
    ? sql`s.status = ${ship.expect.status}::cm_shipment_status and ${sameTime(sql`s.shipped_at`, ship.expect.shippedAt)} and ${sameTime(sql`s.delivered_at`, ship.expect.deliveredAt)} and ${sameTime(sql`s.updated_at`, applied?.updatedAt ?? null)}`
    : sql`false`;
  const side = plan.alsoUnmark;
  const res = await db.execute(sql`
    with p_lock as (
      -- The partnership first (every stage move locks it first too, so the two can't deadlock), still at the stage the
      -- checks saw and with no real move since the press's own.
      select p.id from ${cmPartnerships} p
      where p.id = ${a.partnershipId} and p.stage = ${plan.stageNow}::cm_stage
        and (not ${!!move} or not exists (
          select 1 from cm_stage_transitions t2
          where t2.partnership_id = ${a.partnershipId} and t2.id <> ${a.transitionId} and t2.undone_at is null
            and coalesce(t2.reason, '') <> 'undo'
            and t2.changed_at >= (select t1.changed_at from cm_stage_transitions t1 where t1.id = ${a.transitionId})
        ))
      for no key update
    ), gate as (
      -- The press, still not undone: locked, so a doubled click waits and then finds it done.
      select id from ${cmQuickActions} where id = ${a.id} and undone_at is null and exists (select 1 from p_lock) for update
    ), ship_lock as (
      -- The shipment exactly as the press left it (and, to delete it, still without tracking).
      select s.id from ${cmShipments} s
      where ${hasShipment} and s.id = ${a.shipmentId} and s.partnership_id = ${a.partnershipId} and ${expected}
        and (not ${deleting} or (s.carrier is null and s.tracking_number is null))
        and exists (select 1 from gate)
      for update
    ), moved as (
      update ${cmPartnerships}
      set stage = ${move?.to ?? null}::cm_stage, exit_reason = ${move?.exitReason ?? null}::cm_exit_reason, updated_at = now()
      where ${!!move} and id = ${a.partnershipId} and stage = ${move?.from ?? null}::cm_stage
        and exists (select 1 from gate) and (not ${hasShipment} or exists (select 1 from ship_lock))
      returning id
    ), go as (
      -- All or nothing: still undoable, the shipment untouched since, and the stage back (when the press moved it).
      select 1 as ok from gate
      where (not ${hasShipment} or exists (select 1 from ship_lock)) and (not ${!!move} or exists (select 1 from moved))
    ), restored as (
      update ${cmShipments}
      set status = ${to?.status ?? "ready"}::cm_shipment_status, shipped_at = ${to?.shippedAt ?? null}::timestamp,
          delivered_at = ${to?.deliveredAt ?? null}::timestamp, updated_at = now()
      where ${restoring} and id = ${a.shipmentId} and partnership_id = ${a.partnershipId} and exists (select 1 from go)
      returning id
    ), removed as (
      delete from ${cmShipments} where ${deleting} and id = ${a.shipmentId} and partnership_id = ${a.partnershipId} and exists (select 1 from go)
      returning id
    ), side_unmarked as (
      -- The other shipment the move to Shipped marked: back to not sent yet, only if untouched since that move.
      update ${cmShipments}
      set status = 'ready', shipped_at = null, updated_at = now()
      where ${!!side} and id = ${side?.id ?? null} and partnership_id = ${a.partnershipId} and status = 'shipped'
        and ${sameTime(sql`updated_at`, side?.markedAt ?? null)} and exists (select 1 from go)
      returning id
    ), unlogged as (
      delete from ${cmOutreachEvents}
      where ${plan.deleteEvent} and id = ${a.outreachEventId} and partnership_id = ${a.partnershipId} and external_id is null and exists (select 1 from go)
      returning id
    ), undone_move as (
      update cm_stage_transitions set undone_at = now()
      where ${!!move} and id = ${a.transitionId} and undone_at is null and exists (select 1 from go)
      returning id
    ), undo_row as (
      insert into cm_stage_transitions (partnership_id, from_stage, to_stage, changed_by, source, reason, meta)
      select id, ${move?.from ?? null}::cm_stage, ${move?.to ?? null}::cm_stage, ${userId}::uuid, 'manual', 'undo',
             jsonb_build_object('undoOf', ${a.transitionId}::text, 'quickActionId', ${a.id}::text)
      from moved
      returning id
    ), done as (
      update ${cmQuickActions} set undone_at = now() where id = ${a.id} and exists (select 1 from go)
      returning id
    )
    select (select count(*) from done)::int as done
  `);
  return Number((res.rows[0] as { done?: number } | undefined)?.done ?? 0) === 1;
}

export type UndoResult = { ok: true; stage: CmStage | null } | { ok: false; error: string };

/**
 * `hooks.beforeWrite` runs between the checks and the write — only the race
 * tests use it, to change something in that gap and prove nothing is written.
 */
export async function undoQuickAction(actionId: string, userId: string, now = new Date(), hooks: { beforeWrite?: () => Promise<void> } = {}): Promise<UndoResult> {
  const [a] = await db.select().from(cmQuickActions).where(eq(cmQuickActions.id, actionId)).limit(1);
  if (!a) return { ok: false, error: UNDO_MESSAGES.gone };
  const facts: QuickActionFacts = { ...a, prior: a.prior as ShipmentSnapshot | null, applied: a.applied as ShipmentSnapshot | null };

  const [[p], [event], [transition], [latest], [shipment]] = await Promise.all([
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
  ]);
  if (!p) return { ok: false, error: UNDO_MESSAGES.gone };

  const plan = planQuickUndo(facts, {
    userId,
    now,
    event: event ?? null,
    transition: transition ?? null,
    latestRealMoveId: latest?.id ?? null,
    stage: p.stage,
    shipment: shipment ? snapshotShipment(shipment) : null,
  });
  if (!plan.ok) return plan;

  await hooks.beforeWrite?.();
  if (await writeUndo(a, plan, facts.applied, userId)) return { ok: true, stage: plan.backTo };

  // Nothing was written: something changed between the checks and the write. Say what.
  const [again] = await db.select({ undoneAt: cmQuickActions.undoneAt }).from(cmQuickActions).where(eq(cmQuickActions.id, a.id)).limit(1);
  if (again?.undoneAt) return { ok: false, error: UNDO_MESSAGES.already };
  const [q] = await db.select({ stage: cmPartnerships.stage }).from(cmPartnerships).where(eq(cmPartnerships.id, a.partnershipId)).limit(1);
  if (q?.stage !== plan.stageNow) return { ok: false, error: UNDO_MESSAGES.stageMoved };
  if (plan.shipment) {
    const [s2] = a.shipmentId ? await db.select().from(cmShipments).where(eq(cmShipments.id, a.shipmentId)).limit(1) : [];
    const cur = s2 ? snapshotShipment(s2) : null;
    const was = facts.applied;
    if (!cur || !was || cur.updatedAt !== was.updatedAt || cur.status !== was.status || cur.shippedAt !== was.shippedAt || cur.deliveredAt !== was.deliveredAt) {
      return { ok: false, error: UNDO_MESSAGES.shipmentChanged };
    }
  }
  // The stage is where it was but someone moved it away and back since.
  return { ok: false, error: UNDO_MESSAGES.stageMoved };
}
