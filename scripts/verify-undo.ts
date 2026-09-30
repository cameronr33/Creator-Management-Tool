/**
 * Verifies Undo on the quick buttons (2026-09-28).
 *
 *   npm run preview:verify -- scripts/verify-undo.ts
 *
 * Part 1 (pure): planQuickUndo's matrix — who, how long, once, never mail the
 * mailbox holds, never after the stage or the shipment changed since.
 * Part 2 (live DB, self-cleaning): the four buttons end to end (I messaged
 * them, They replied from No response, Mark shipped, Mark delivered), a
 * shipment the press created, every refusal, undo B then A, a doubled click,
 * that a change landing between the checks and the write leaves nothing
 * written (an undo is one statement: all of it or none — review, 2026-09-28),
 * that only the shipment the press touched changes, that the email reader
 * still respects a quick Undo, and that the portal's presses are never
 * recorded.
 * Throwaway __verify_ rows, cleaned up in finally.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";
import {
  UNDO_MESSAGES,
  UNDO_WINDOW_MS,
  planQuickUndo,
  undoQuickAction,
  type QuickActionFacts,
  type ShipmentSnapshot,
  type UndoState,
} from "../src/lib/quick-actions";
import { logMessage } from "../src/lib/logging";
import { recordShipment } from "../src/lib/shipments";
import { moveStage } from "../src/lib/stage-moves";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";
import { changeStage } from "../src/lib/mutations";
import { lastManualChangeAt } from "../src/lib/email-ingest";
import { undoMove } from "../src/lib/email-status";
import { approve, pass, undoApproval, undoPass } from "../src/lib/approvals";
import { moveToCampaign, restoreCampaigns } from "../src/lib/campaigns";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

function pure() {
  console.log("\n── Who, how long, once ──");
  const me = "11111111-1111-1111-1111-111111111111";
  const T0 = new Date("2026-09-28T12:00:00Z");
  const act: QuickActionFacts = {
    kind: "message",
    createdBy: me,
    createdAt: T0,
    undoneAt: null,
    outreachEventId: "e1",
    transitionId: "t1",
    shipmentId: null,
    prior: null,
    applied: null,
    createdShipment: false,
  };
  const st: UndoState = {
    userId: me,
    now: new Date(T0.getTime() + 5_000),
    event: { externalId: null },
    transition: { id: "t1", fromStage: "shortlisted", toStage: "contacted", undoneAt: null, meta: {}, changedAt: T0 },
    latestRealMoveId: "t1",
    stage: "contacted",
    shipment: null,
  };
  const plan = (a: Partial<QuickActionFacts>, s: Partial<UndoState>) => planQuickUndo({ ...act, ...a }, { ...st, ...s });
  const err = (a: Partial<QuickActionFacts>, s: Partial<UndoState>) => {
    const p = plan(a, s);
    return p.ok ? null : p.error;
  };
  const ok = plan({}, {});
  check("your own press, seconds ago: the stage goes back and the message goes", ok.ok && ok.moveBack?.from === "contacted" && ok.moveBack.to === "shortlisted" && ok.backTo === "shortlisted" && ok.deleteEvent);
  check("already undone: refused", err({ undoneAt: T0 }, {}) === UNDO_MESSAGES.already);
  check("someone else's press: refused", err({}, { userId: "22222222-2222-2222-2222-222222222222" }) === UNDO_MESSAGES.notYours);
  check("a press whose teammate has since left: nobody can undo it", err({ createdBy: null }, {}) === UNDO_MESSAGES.notYours);
  check("exactly ten minutes on: still allowed", plan({}, { now: new Date(T0.getTime() + UNDO_WINDOW_MS) }).ok);
  check("a moment later: too late", err({}, { now: new Date(T0.getTime() + UNDO_WINDOW_MS + 1) }) === UNDO_MESSAGES.tooLate);

  console.log("\n── Never the mailbox's mail; never after the stage moved ──");
  check("a press pointing at mail the mailbox holds: refused", err({}, { event: { externalId: "gmail-1" } }) === UNDO_MESSAGES.synced);
  check("the message was removed since: the stage still goes back", (() => { const p = plan({}, { event: null }); return p.ok && !p.deleteEvent && !!p.moveBack; })());
  check("another move since (a person's or the email reader's): refused", err({}, { latestRealMoveId: "t9" }) === UNDO_MESSAGES.stageMoved);
  check("the stage isn't where the press left it: refused", err({}, { stage: "in_conversation" }) === UNDO_MESSAGES.stageMoved);
  check("the press's move is gone or undone some other way: refused", err({}, { transition: null }) === UNDO_MESSAGES.stageMoved && err({}, { transition: { ...st.transition!, undoneAt: T0 } }) === UNDO_MESSAGES.stageMoved);
  const noMove = plan({ transitionId: null }, { transition: null, latestRealMoveId: "t9" });
  check("a press that moved nothing: only the message goes", noMove.ok && noMove.moveBack === null && noMove.backTo === null && noMove.deleteEvent);
  const reason = plan({}, { transition: { id: "t1", fromStage: "no_response", toStage: "in_conversation", undoneAt: null, meta: { priorExitReason: "went_dark" }, changedAt: T0 }, stage: "in_conversation" });
  check("back to No response brings its reason back", reason.ok && reason.moveBack?.to === "no_response" && reason.moveBack.exitReason === "went_dark");
  check("back to an open stage carries no exit reason", ok.ok && ok.moveBack?.exitReason === null);

  console.log("\n── The shipment must be as the press left it ──");
  const snap = (x: Partial<ShipmentSnapshot>): ShipmentSnapshot => ({ status: "shipped", carrier: null, trackingNumber: null, shippedAt: "2026-09-28T12:00:00.000Z", deliveredAt: null, notes: null, updatedAt: "2026-09-28T12:00:00.500Z", ...x });
  const ship: Partial<QuickActionFacts> = { kind: "shipment", outreachEventId: null, shipmentId: "s1", prior: snap({ status: "ready", shippedAt: null, updatedAt: "2026-09-27T10:00:00.000Z" }), applied: snap({}) };
  const shipState: Partial<UndoState> = { event: null, transition: { id: "t1", fromStage: "fulfilling", toStage: "shipped", undoneAt: null, meta: {}, changedAt: T0 }, stage: "shipped", shipment: snap({}) };
  const s1 = plan(ship, shipState);
  check(
    "untouched since: put back as it was, and only if it's still as the press left it",
    s1.ok && s1.moveBack?.to === "fulfilling" && s1.shipment?.mode === "restore" && s1.shipment.to.status === "ready" && s1.shipment.to.shippedAt === null && s1.shipment.expect.status === "shipped" && s1.shipment.expect.shippedAt === "2026-09-28T12:00:00.000Z",
  );
  check("tracking added since: refused", err(ship, { ...shipState, shipment: snap({ trackingNumber: "1Z", updatedAt: "2026-09-28T12:03:00.000Z" }) }) === UNDO_MESSAGES.shipmentChanged);
  check("the shipment is gone: refused", err(ship, { ...shipState, shipment: null }) === UNDO_MESSAGES.shipmentChanged);
  const created: Partial<QuickActionFacts> = { ...ship, prior: null, createdShipment: true };
  const atAgreed: Partial<UndoState> = { ...shipState, transition: { id: "t1", fromStage: "awaiting_address", toStage: "shipped", undoneAt: null, meta: {}, changedAt: T0 } };
  const gone = plan(created, atAgreed);
  check("a shipment the press created goes, when the stage no longer needs one", gone.ok && gone.shipment?.mode === "delete");
  const kept = plan(created, { ...atAgreed, shipment: snap({ trackingNumber: "1Z" }) });
  check("…unless it has tracking: then it stays, back to not sent yet", kept.ok && kept.shipment?.mode === "restore" && kept.shipment.to.status === "ready");
  // Second review (2026-09-28): the press's own move to Shipped also marks "the latest shipment" — that one goes back too.
  const side = plan(ship, { ...shipState, transition: { ...(shipState.transition as NonNullable<UndoState["transition"]>), meta: { markedShippedId: "s2" } } });
  check("a second shipment the press's move marked shipped is put back too", side.ok && side.alsoUnmark?.id === "s2" && side.alsoUnmark.markedAt === T0.toISOString());
  const same = plan(ship, { ...shipState, transition: { ...(shipState.transition as NonNullable<UndoState["transition"]>), meta: { markedShippedId: "s1" } } });
  check("…but not the pressed one twice", same.ok && same.alsoUnmark === null);
}

async function live() {
  console.log("\n── Live: the four buttons, there and back (cleaned up after) ──");
  const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.slug, "hella")).limit(1);
  const [me] = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  if (!client || !me) {
    check("HELLA and a teammate exist to test with", false);
    return;
  }
  const agency = { kind: "agency" as const, userId: me.id };
  let campaignId = "00000000-0000-0000-0000-000000000000";
  let campaignB = "00000000-0000-0000-0000-000000000000";
  const creatorIds: string[] = [];
  const add = async (h: string) => {
    const r = await createCreatorWithPartnership({ clientId: client.id, name: h, links: [`https://www.instagram.com/${h}`], campaignId });
    creatorIds.push(r.creatorId);
    return r.partnershipId;
  };
  const partnership = async (id: string) => (await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, id)))[0];
  const stageOf = async (id: string) => (await partnership(id))?.stage;
  const eventsOf = (id: string) => db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.partnershipId, id));
  const shipmentsOf = (id: string) => db.select().from(schema.cmShipments).where(eq(schema.cmShipments.partnershipId, id));
  const undoRowsFor = async (actionId: string) =>
    db.select().from(schema.cmStageTransitions).where(and(eq(schema.cmStageTransitions.reason, "undo"), sql`${schema.cmStageTransitions.meta}->>'quickActionId' = ${actionId}`));
  try {
    campaignId = await ensureCampaignByName(client.id, "__verify_undo__");

    // 1. I messaged them: To contact → Contacted, and back.
    const a = await add("__verify_un_contacted");
    const pressA = await logMessage({ partnershipId: a, direction: "outbound", channel: "ig_dm", kind: "initial" }, me.id);
    check("I messaged them: moves to Contacted and comes back undoable", pressA.ok && pressA.stageChanged?.to === "contacted" && !!pressA.undo);
    if (!pressA.ok) return;
    const [actionA] = await db.select().from(schema.cmQuickActions).where(eq(schema.cmQuickActions.id, pressA.undo.actionId));
    check("…the server kept what the press did", actionA?.kind === "message" && actionA.createdBy === me.id && actionA.outreachEventId === pressA.eventId && actionA.transitionId === pressA.stageChanged?.transitionId);
    const undoA = await undoQuickAction(pressA.undo.actionId, me.id);
    check("Undo: back to To contact", undoA.ok && undoA.stage === "shortlisted" && (await stageOf(a)) === "shortlisted", JSON.stringify(undoA));
    check("…the logged DM is gone", (await eventsOf(a)).length === 0);
    const [forward] = await db.select().from(schema.cmStageTransitions).where(eq(schema.cmStageTransitions.id, pressA.stageChanged!.transitionId));
    const undoRows = await undoRowsFor(pressA.undo.actionId);
    check("…the move is marked undone, and the undo is a person's move pointing at it", !!forward?.undoneAt && undoRows.length === 1 && undoRows[0].source === "manual" && (undoRows[0].meta as { undoOf?: string }).undoOf === forward.id);
    check("…and the press is marked undone", !!(await db.select().from(schema.cmQuickActions).where(eq(schema.cmQuickActions.id, pressA.undo.actionId)))[0]?.undoneAt);
    const twice = await undoQuickAction(pressA.undo.actionId, me.id);
    check("Undo twice is refused", !twice.ok && twice.error === UNDO_MESSAGES.already);
    const relog = await logMessage({ partnershipId: a, direction: "outbound", channel: "ig_dm", kind: "initial", occurredAt: new Date(Date.now() - 86_400_000).toISOString() }, me.id);
    check("re-logged as yesterday after the Undo, it still moves the stage (an Undo isn't a person's say)", relog.ok && !relog.stageSkipped && relog.stageChanged?.to === "contacted");

    // 2. They replied: No response → Talking, and back with its reason.
    const b = await add("__verify_un_reopen");
    await changeStage(b, "contacted", me.id);
    await changeStage(b, "no_response", me.id, { exitReason: "went_dark" });
    const pressB = await logMessage({ partnershipId: b, direction: "inbound", channel: "ig_dm", kind: "reply" }, me.id);
    check("They replied: reopens No response → Talking", pressB.ok && pressB.stageChanged?.to === "in_conversation" && (await partnership(b))?.exitReason === null);
    const undoB = pressB.ok ? await undoQuickAction(pressB.undo.actionId, me.id) : null;
    const pb = await partnership(b);
    check("Undo: back to No response, with Stopped replying restored", !!undoB?.ok && pb?.stage === "no_response" && pb.exitReason === "went_dark", JSON.stringify({ undoB, stage: pb?.stage, reason: pb?.exitReason }));

    // 3. Mark shipped, with tracking typed alongside, and back.
    const c = await add("__verify_un_ship");
    await changeStage(c, "fulfilling", me.id);
    const [placeholder] = await shipmentsOf(c);
    const pressC = await recordShipment({ id: placeholder.id, partnershipId: c, status: "shipped", carrier: "UPS", trackingNumber: "1ZVERIFYUNDO" }, agency);
    check("Mark shipped: Ready to ship → Shipped, undoable", pressC.ok && pressC.stageChanged?.to === "shipped" && !!pressC.undo);
    const undoC = pressC.ok && pressC.undo ? await undoQuickAction(pressC.undo.actionId, me.id) : null;
    const shipsC = await shipmentsOf(c);
    check("Undo: back to Ready to ship", !!undoC?.ok && undoC.stage === "fulfilling" && (await stageOf(c)) === "fulfilling", JSON.stringify(undoC));
    check("…one shipment, ready again, with no ship date", shipsC.length === 1 && shipsC[0].status === "ready" && shipsC[0].shippedAt === null);
    check("…the tracking number typed with it is kept", shipsC[0]?.carrier === "UPS" && shipsC[0].trackingNumber === "1ZVERIFYUNDO");

    // 4. Mark delivered, and back.
    const d = await add("__verify_un_deliver");
    await changeStage(d, "shipped", me.id);
    const [sentD] = await shipmentsOf(d);
    const pressD = await recordShipment({ id: sentD.id, partnershipId: d, status: "delivered" }, agency);
    check("Mark delivered: Shipped → Waiting on video, undoable", pressD.ok && pressD.stageChanged?.to === "content_pending" && !!pressD.undo);
    const undoD = pressD.ok && pressD.undo ? await undoQuickAction(pressD.undo.actionId, me.id) : null;
    const [afterD] = await shipmentsOf(d);
    check("Undo: back to Shipped — still on its way, no delivery date, ship date kept", !!undoD?.ok && (await stageOf(d)) === "shipped" && afterD.status === "shipped" && afterD.deliveredAt === null && afterD.shippedAt?.getTime() === sentD.shippedAt?.getTime());

    // A shipment the press created goes with its Undo.
    const e = await add("__verify_un_created");
    await changeStage(e, "awaiting_address", me.id);
    const pressE = await recordShipment({ partnershipId: e, status: "shipped" }, agency);
    check("Mark shipped at Agreed: creates the shipment and moves to Shipped", pressE.ok && pressE.stageChanged?.to === "shipped" && (await shipmentsOf(e)).length === 1);
    const undoE = pressE.ok && pressE.undo ? await undoQuickAction(pressE.undo.actionId, me.id) : null;
    check("Undo: back to Agreed, and the shipment it created is gone", !!undoE?.ok && (await stageOf(e)) === "awaiting_address" && (await shipmentsOf(e)).length === 0);

    console.log("\n── Refusals write nothing ──");
    const f = await add("__verify_un_refusals");
    const pressF = await logMessage({ partnershipId: f, direction: "outbound", channel: "ig_dm", kind: "initial" }, me.id);
    if (!pressF.ok) return;
    const other = await undoQuickAction(pressF.undo.actionId, "00000000-0000-0000-0000-00000000abcd");
    check("another teammate: refused", !other.ok && other.error === UNDO_MESSAGES.notYours && (await stageOf(f)) === "contacted" && (await eventsOf(f)).length === 1);
    const late = await undoQuickAction(pressF.undo.actionId, me.id, new Date(Date.now() + UNDO_WINDOW_MS + 60_000));
    check("eleven minutes on: too late", !late.ok && late.error === UNDO_MESSAGES.tooLate && (await stageOf(f)) === "contacted");
    await changeStage(f, "in_conversation", me.id);
    const afterManual = await undoQuickAction(pressF.undo.actionId, me.id);
    check("after a person moved the stage: refused, their move stands", !afterManual.ok && afterManual.error === UNDO_MESSAGES.stageMoved && (await stageOf(f)) === "in_conversation" && (await eventsOf(f)).length === 1);

    const round = await add("__verify_un_round_trip");
    const pressRound = await logMessage({ partnershipId: round, direction: "outbound", channel: "ig_dm", kind: "initial" }, me.id);
    await changeStage(round, "in_conversation", me.id);
    await changeStage(round, "contacted", me.id);
    const afterRound = pressRound.ok ? await undoQuickAction(pressRound.undo.actionId, me.id) : null;
    check("a person moved it away and back since: still refused (the stage only looks unchanged)", !!afterRound && !afterRound.ok && afterRound.error === UNDO_MESSAGES.stageMoved && (await stageOf(round)) === "contacted");

    const g = await add("__verify_un_after_email");
    const pressG = await logMessage({ partnershipId: g, direction: "outbound", channel: "ig_dm", kind: "initial" }, me.id);
    await moveStage({ partnershipId: g, to: "in_conversation", source: "email", expectFrom: "contacted", reason: "Sounds great!" });
    const afterEmail = pressG.ok ? await undoQuickAction(pressG.undo.actionId, me.id) : null;
    check("after the email reader moved it: refused", !!afterEmail && !afterEmail.ok && afterEmail.error === UNDO_MESSAGES.stageMoved && (await stageOf(g)) === "in_conversation");

    const h = await add("__verify_un_ship_edit");
    await changeStage(h, "fulfilling", me.id);
    const [sh] = await shipmentsOf(h);
    const pressH = await recordShipment({ id: sh.id, partnershipId: h, status: "shipped" }, agency);
    const [pressed] = await shipmentsOf(h);
    await new Promise((r) => setTimeout(r, 20));
    const detailsSave = await recordShipment({ id: sh.id, partnershipId: h, status: "shipped", trackingNumber: "1ZLATER" }, agency);
    const [edited] = await shipmentsOf(h);
    // NEGATIVE (2026-09-28): saving details on a shipped shipment re-stamped shippedAt, restarting "Shipped N days ago".
    check("saving a tracking number later keeps the ship date", !!pressed.shippedAt && edited.shippedAt?.getTime() === pressed.shippedAt.getTime(), `${pressed.shippedAt?.toISOString()} → ${edited.shippedAt?.toISOString()}`);
    check("…and isn't itself an undoable press (the status didn't change)", detailsSave.ok && detailsSave.undo === null);
    const afterEdit = pressH.ok && pressH.undo ? await undoQuickAction(pressH.undo.actionId, me.id) : null;
    check("after the shipment was changed: refused", !!afterEdit && !afterEdit.ok && afterEdit.error === UNDO_MESSAGES.shipmentChanged && (await stageOf(h)) === "shipped");

    const k = await add("__verify_un_forged");
    const [synced] = await db
      .insert(schema.cmOutreachEvents)
      .values({ partnershipId: k, direction: "inbound", channel: "email", kind: "reply", senderRole: "creator", body: "Yes please", occurredAt: new Date(), externalId: "__verify_un_synced" })
      .returning({ id: schema.cmOutreachEvents.id });
    const [forged] = await db.insert(schema.cmQuickActions).values({ partnershipId: k, kind: "message", createdBy: me.id, outreachEventId: synced.id }).returning({ id: schema.cmQuickActions.id });
    const forgedUndo = await undoQuickAction(forged.id, me.id);
    check("a forged press pointing at the mailbox's mail: refused, the email stays", !forgedUndo.ok && forgedUndo.error === UNDO_MESSAGES.synced && (await eventsOf(k)).some((x) => x.id === synced.id));
    await db.delete(schema.cmQuickActions).where(eq(schema.cmQuickActions.id, forged.id));

    console.log("\n── Order, doubles, and a change in the gap ──");
    const m = await add("__verify_un_order");
    const first = await logMessage({ partnershipId: m, direction: "outbound", channel: "ig_dm", kind: "initial" }, me.id);
    const second = await logMessage({ partnershipId: m, direction: "inbound", channel: "ig_dm", kind: "reply" }, me.id);
    if (!first.ok || !second.ok) return;
    const firstTooSoon = await undoQuickAction(first.undo.actionId, me.id);
    check("undo the first press while the second's move stands: refused", !firstTooSoon.ok && firstTooSoon.error === UNDO_MESSAGES.stageMoved && (await stageOf(m)) === "in_conversation");
    const u2 = await undoQuickAction(second.undo.actionId, me.id);
    const u1 = await undoQuickAction(first.undo.actionId, me.id);
    check("undo the second, then the first: back to Contacted, then To contact", u2.ok && u2.stage === "contacted" && u1.ok && u1.stage === "shortlisted" && (await stageOf(m)) === "shortlisted");
    check("…both messages gone", (await eventsOf(m)).length === 0);

    const n = await add("__verify_un_double");
    const pressN = await logMessage({ partnershipId: n, direction: "outbound", channel: "ig_dm", kind: "initial" }, me.id);
    if (!pressN.ok) return;
    const [x1, x2] = await Promise.all([undoQuickAction(pressN.undo.actionId, me.id), undoQuickAction(pressN.undo.actionId, me.id)]);
    check("a doubled Undo click ends in one undo, not two", (x1.ok || x2.ok) && (await stageOf(n)) === "shortlisted" && (await undoRowsFor(pressN.undo.actionId)).length === 1 && (await eventsOf(n)).length === 0, JSON.stringify([x1, x2]));
    check("…and the second click never reports that the stage moved", [x1, x2].every((x) => x.ok || x.error === UNDO_MESSAGES.already), JSON.stringify([x1, x2]));

    // NEGATIVE (review, 2026-09-28): the undo was five separate writes; one failing left half an undo nobody could finish.
    const q = await add("__verify_un_gap_stage");
    const pressQ = await logMessage({ partnershipId: q, direction: "outbound", channel: "ig_dm", kind: "initial" }, me.id);
    if (!pressQ.ok) return;
    const raced = await undoQuickAction(pressQ.undo.actionId, me.id, new Date(), { beforeWrite: async () => void (await changeStage(q, "in_conversation", me.id)) });
    const [actionQ] = await db.select().from(schema.cmQuickActions).where(eq(schema.cmQuickActions.id, pressQ.undo.actionId));
    const [moveQ] = await db.select().from(schema.cmStageTransitions).where(eq(schema.cmStageTransitions.id, pressQ.stageChanged!.transitionId));
    check(
      "a stage move landing between the checks and the write: nothing at all is written",
      !raced.ok && raced.error === UNDO_MESSAGES.stageMoved && (await stageOf(q)) === "in_conversation" && (await eventsOf(q)).length === 1 && !actionQ.undoneAt && !moveQ.undoneAt && (await undoRowsFor(pressQ.undo.actionId)).length === 0,
      JSON.stringify(raced),
    );

    const w = await add("__verify_un_gap_ship");
    await changeStage(w, "fulfilling", me.id);
    const [shipW] = await shipmentsOf(w);
    const pressW = await recordShipment({ id: shipW.id, partnershipId: w, status: "shipped" }, agency);
    const racedW =
      pressW.ok && pressW.undo
        ? await undoQuickAction(pressW.undo.actionId, me.id, new Date(), { beforeWrite: async () => void (await db.update(schema.cmShipments).set({ status: "returned" }).where(eq(schema.cmShipments.id, shipW.id))) })
        : null;
    const [afterW] = await shipmentsOf(w);
    check(
      "the shipment changing in that gap: nothing is written, their change stands",
      !!racedW && !racedW.ok && racedW.error === UNDO_MESSAGES.shipmentChanged && (await stageOf(w)) === "shipped" && afterW.status === "returned",
      JSON.stringify(racedW),
    );

    // NEGATIVE (review, 2026-09-28): the undo moved the stage through moveStage, which re-marked "the latest shipment" — not the one pressed.
    const two = await add("__verify_un_two_ships");
    await changeStage(two, "shipped", me.id);
    const [older] = await shipmentsOf(two);
    const [newer] = await db.insert(schema.cmShipments).values({ partnershipId: two, status: "ready" }).returning();
    const pressTwo = await recordShipment({ id: older.id, partnershipId: two, status: "delivered" }, agency);
    const undoTwo = pressTwo.ok && pressTwo.undo ? await undoQuickAction(pressTwo.undo.actionId, me.id) : null;
    const rows = await shipmentsOf(two);
    const olderNow = rows.find((r) => r.id === older.id);
    const newerNow = rows.find((r) => r.id === newer.id);
    check(
      "with two shipments, only the one pressed is put back; the other is untouched",
      !!undoTwo?.ok && (await stageOf(two)) === "shipped" && olderNow?.status === "shipped" && olderNow.deliveredAt === null && newerNow?.status === "ready" && newerNow.shippedAt === null,
      JSON.stringify({ undoTwo, older: olderNow?.status, newer: newerNow?.status, newerShipped: newerNow?.shippedAt }),
    );

    // NEGATIVE (second review, 2026-09-28): with two "ready" shipments, the press's move to Shipped marked the newer one too — and Undo left it shipped.
    const tr2 = await add("__verify_un_two_ready");
    await changeStage(tr2, "fulfilling", me.id);
    const [firstShip] = await shipmentsOf(tr2);
    await db.insert(schema.cmShipments).values({ partnershipId: tr2, status: "ready" });
    const pressTr2 = await recordShipment({ id: firstShip.id, partnershipId: tr2, status: "shipped" }, agency);
    const bothShipped = (await shipmentsOf(tr2)).every((x) => x.status === "shipped");
    const undoTr2 = pressTr2.ok && pressTr2.undo ? await undoQuickAction(pressTr2.undo.actionId, me.id) : null;
    const afterTr2 = await shipmentsOf(tr2);
    check(
      "with two shipments, the one the stage move marked shipped goes back too",
      bothShipped && !!undoTr2?.ok && (await stageOf(tr2)) === "fulfilling" && afterTr2.length === 2 && afterTr2.every((x) => x.status === "ready" && x.shippedAt === null),
      JSON.stringify({ bothShipped, undoTr2, after: afterTr2.map((x) => x.status) }),
    );

    // NEGATIVE (second review): the write only compared status and dates, so a tracking number saved in the gap slipped through.
    const tg = await add("__verify_un_gap_tracking");
    await changeStage(tg, "fulfilling", me.id);
    const [shipTg] = await shipmentsOf(tg);
    const pressTg = await recordShipment({ id: shipTg.id, partnershipId: tg, status: "shipped" }, agency);
    const racedTg =
      pressTg.ok && pressTg.undo
        ? await undoQuickAction(pressTg.undo.actionId, me.id, new Date(), {
            beforeWrite: async () => void (await recordShipment({ id: shipTg.id, partnershipId: tg, status: "shipped", trackingNumber: "1ZGAP" }, agency)),
          })
        : null;
    const [afterTg] = await shipmentsOf(tg);
    check(
      "a tracking number saved in that gap: refused too — still shipped, tracking kept",
      !!racedTg && !racedTg.ok && racedTg.error === UNDO_MESSAGES.shipmentChanged && (await stageOf(tg)) === "shipped" && afterTg.status === "shipped" && afterTg.trackingNumber === "1ZGAP",
      JSON.stringify(racedTg),
    );

    // NEGATIVE (second review): a stage moved away and back in the gap looked unchanged to the write.
    const bounce = await add("__verify_un_gap_bounce");
    const pressBounce = await logMessage({ partnershipId: bounce, direction: "outbound", channel: "ig_dm", kind: "initial" }, me.id);
    const racedBounce = pressBounce.ok
      ? await undoQuickAction(pressBounce.undo.actionId, me.id, new Date(), {
          beforeWrite: async () => {
            await changeStage(bounce, "in_conversation", me.id);
            await changeStage(bounce, "contacted", me.id);
          },
        })
      : null;
    check(
      "the stage moved away and back in that gap: refused, their moves stand",
      !!racedBounce && !racedBounce.ok && racedBounce.error === UNDO_MESSAGES.stageMoved && (await stageOf(bounce)) === "contacted" && (await eventsOf(bounce)).length === 1,
      JSON.stringify(racedBounce),
    );

    // NEGATIVE (second review): an undo that moves no stage decided "delete the shipment" on the stage it read — even if the deal moved to Ready to ship meanwhile.
    const talk = await add("__verify_un_gap_nomove");
    await changeStage(talk, "in_conversation", me.id);
    const pressTalk = await recordShipment({ partnershipId: talk, status: "shipped" }, agency);
    const racedTalk =
      pressTalk.ok && pressTalk.undo && pressTalk.stageChanged === null
        ? await undoQuickAction(pressTalk.undo.actionId, me.id, new Date(), { beforeWrite: async () => void (await changeStage(talk, "fulfilling", me.id)) })
        : null;
    check(
      "the deal moved on in that gap: nothing is written — Ready to ship keeps its shipment",
      !!racedTalk && !racedTalk.ok && racedTalk.error === UNDO_MESSAGES.stageMoved && (await stageOf(talk)) === "fulfilling" && (await shipmentsOf(talk)).length === 1,
      JSON.stringify(racedTalk),
    );

    // Review, 2026-09-28: a quick Undo is a person's decision to the email reader — older mail must not redo it.
    const r2 = await add("__verify_un_reader");
    await changeStage(r2, "shipped", me.id);
    const pressR2 = await recordShipment({ partnershipId: r2, status: "delivered" }, agency);
    const beforeUndo = new Date();
    if (pressR2.ok && pressR2.undo) await undoQuickAction(pressR2.undo.actionId, me.id);
    const readerSays = (await lastManualChangeAt([r2])).get(r2);
    const loggingSays = (await lastManualChangeAt([r2], { peopleOnly: true })).get(r2);
    check("to the email reader, the Undo is the last say (older mail can't redo it)", !!readerSays && readerSays.getTime() >= beforeUndo.getTime() - 1_000, readerSays?.toISOString());
    check("…while a message logged with an earlier date looks past it", !!loggingSays && loggingSays.getTime() < beforeUndo.getTime() - 1, loggingSays?.toISOString());

    const r = await add("__verify_un_no_move");
    await changeStage(r, "contacted", me.id);
    const pressR = await logMessage({ partnershipId: r, direction: "outbound", channel: "ig_dm", kind: "follow_up" }, me.id);
    const undoR = pressR.ok ? await undoQuickAction(pressR.undo.actionId, me.id) : null;
    check("a follow-up that moved nothing: Undo removes just the message", pressR.ok && pressR.stageChanged === null && !!undoR?.ok && undoR.stage === null && (await stageOf(r)) === "contacted" && (await eventsOf(r)).length === 0);

    const portalSide = await add("__verify_un_portal");
    await changeStage(portalSide, "fulfilling", me.id);
    const byClient = await recordShipment({ partnershipId: portalSide, status: "shipped" }, { kind: "client", id: "00000000-0000-0000-0000-000000000009", name: "Rob Client" });
    const recorded = await db.select().from(schema.cmQuickActions).where(eq(schema.cmQuickActions.partnershipId, portalSide));
    check("the brand marking it shipped in the portal is never an undoable press here", byClient.ok && byClient.undo === null && recorded.length === 0);

    // Interaction review 2026-09-30 (owner: I14): Undo where it was missing.
    console.log("\n── Undo a stage you picked, a bulk campaign move, Approve and Pass ──");
    const someoneElse = "00000000-0000-0000-0000-00000000abcd";
    const transitionOf = async (id: string) => (await db.select().from(schema.cmStageTransitions).where(eq(schema.cmStageTransitions.id, id)))[0];
    const picked = await add("__verify_un_picked");
    await changeStage(picked, "contacted", me.id);
    const mv = await moveStage({ partnershipId: picked, to: "in_conversation", source: "manual", userId: me.id, expectFrom: "contacted" });
    const tid = mv.status === "moved" ? mv.transitionId : "";
    check("someone else can't undo the stage you picked", !(await undoMove(tid, someoneElse)).ok && (await stageOf(picked)) === "in_conversation");
    const back = await undoMove(tid, me.id);
    check("you can: it goes back where it was, and the move is marked undone", back.ok && (await stageOf(picked)) === "contacted" && !!(await transitionOf(tid))?.undoneAt, JSON.stringify(back));
    check("…once", !(await undoMove(tid, me.id)).ok);
    const undoRow = (await db.select().from(schema.cmStageTransitions).where(and(eq(schema.cmStageTransitions.partnershipId, picked), eq(schema.cmStageTransitions.reason, "undo"))))[0];
    check("an Undo can't itself be undone", !!undoRow && !(await undoMove(undoRow.id, me.id)).ok);

    const lateOne = await add("__verify_un_picked_late");
    await changeStage(lateOne, "contacted", me.id);
    const mvLate = await moveStage({ partnershipId: lateOne, to: "in_conversation", source: "manual", userId: me.id, expectFrom: "contacted" });
    if (mvLate.status === "moved") await db.update(schema.cmStageTransitions).set({ changedAt: new Date(Date.now() - UNDO_WINDOW_MS - 60_000) }).where(eq(schema.cmStageTransitions.id, mvLate.transitionId));
    check("not after ten minutes", mvLate.status === "moved" && !(await undoMove(mvLate.transitionId, me.id)).ok && (await stageOf(lateOne)) === "in_conversation");

    const since = await add("__verify_un_picked_since");
    await changeStage(since, "contacted", me.id);
    const mvA = await moveStage({ partnershipId: since, to: "in_conversation", source: "manual", userId: me.id, expectFrom: "contacted" });
    await moveStage({ partnershipId: since, to: "awaiting_address", source: "manual", userId: me.id, expectFrom: "in_conversation" });
    check("not once the stage has moved again", mvA.status === "moved" && !(await undoMove(mvA.transitionId, me.id)).ok && (await stageOf(since)) === "awaiting_address");

    campaignB = await ensureCampaignByName(client.id, "__verify_undo_b__");
    const hop = await add("__verify_un_campaign");
    const hopped = await moveToCampaign([hop], campaignB);
    check("a bulk campaign move says where each one was", hopped.moved === 1 && hopped.prior.length === 1 && hopped.prior[0].campaignId === campaignId);
    const restored = await restoreCampaigns(hopped.prior, campaignB);
    const [hopRow] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, hop));
    check("…and Undo puts it back", restored.restored === 1 && hopRow.campaignId === campaignId);
    await moveToCampaign([hop], campaignB);
    await db.update(schema.cmPartnerships).set({ campaignId }).where(eq(schema.cmPartnerships.id, hop)); // someone moved it back by hand
    check("…but never over a move someone made since", (await restoreCampaigns([{ id: hop, campaignId: campaignB }], campaignB)).restored === 0);

    // Review 2026-09-30: undoMove must not take a pass apart, and must put a closed deal's reason back.
    const reopened = await add("__verify_un_reopen");
    await changeStage(reopened, "in_conversation", me.id);
    await moveStage({ partnershipId: reopened, to: "no_response", source: "manual", userId: me.id, expectFrom: "in_conversation", exitReason: "went_dark" });
    const reopen = await moveStage({ partnershipId: reopened, to: "in_conversation", source: "manual", userId: me.id, expectFrom: "no_response" });
    const backToClosed = reopen.status === "moved" ? await undoMove(reopen.transitionId, me.id) : null;
    const [reRow] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, reopened));
    check("undoing a reopen puts the deal back as it was closed, reason and all", !!backToClosed?.ok && reRow.stage === "no_response" && reRow.exitReason === "went_dark", JSON.stringify({ backToClosed, s: reRow.stage, x: reRow.exitReason }));

    // Identity, not names (review 2026-09-30): same name, different person.
    const decider = { name: "__verify Sam", kind: "agency" as const, userId: me.id };
    const namesake = { name: "__verify Sam", kind: "agency" as const, userId: someoneElse };
    const portalNamesake = { name: "__verify Sam", kind: "client" as const, clientUserId: "00000000-0000-0000-0000-00000000c11e" };
    const notesOf = async (id: string) => (await eventsOf(id)).filter((e) => e.kind === "note");
    const ap = await add("__verify_un_approve");
    await db.update(schema.cmPartnerships).set({ clientApproval: "pending" }).where(eq(schema.cmPartnerships.id, ap));
    const a1 = await approve(client.id, [ap], decider);
    check("Approve says what to undo it with", a1.approved === 1 && !!a1.decidedAt);
    check("a teammate with the same name can't undo your approval", !(await undoApproval(client.id, [ap], namesake, a1.decidedAt ?? "")).undone);
    check("…nor a person at the client with the same name", !(await undoApproval(client.id, [ap], portalNamesake, a1.decidedAt ?? "")).undone);
    // The note-removal cutoff must not depend on the laptop's time zone (review 2026-09-30).
    const zone = process.env.TZ;
    process.env.TZ = "Australia/Sydney";
    const ua = await undoApproval(client.id, [ap], decider, a1.decidedAt ?? "");
    process.env.TZ = zone;
    if (zone === undefined) delete process.env.TZ;
    const [apRow] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, ap));
    check("Undo puts it back to waiting for approval and takes the note off the timeline, whatever the time zone", ua.undone === 1 && apRow.clientApproval === "pending" && apRow.approvalAt === null && apRow.approvalDecider === null && (await notesOf(ap)).length === 0, JSON.stringify({ ua, a: apRow.clientApproval, n: (await notesOf(ap)).length }));
    check("…once", (await undoApproval(client.id, [ap], decider, a1.decidedAt ?? "")).undone === 0);
    const noAsk = await add("__verify_un_approve_noask");
    const a3 = await approve(client.id, [noAsk], decider);
    await undoApproval(client.id, [noAsk], decider, a3.decidedAt ?? "");
    const [noAskRow] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, noAsk));
    check("…and one that wasn't waiting goes back to no approval asked (kept on the server, not sent by the page)", a3.approved === 1 && noAskRow.clientApproval === null);
    const apLate = await add("__verify_un_approve_late");
    await db.update(schema.cmPartnerships).set({ clientApproval: "pending" }).where(eq(schema.cmPartnerships.id, apLate));
    await approve(client.id, [apLate], decider);
    const oldMoment = new Date(Date.now() - UNDO_WINDOW_MS - 60_000);
    await db.update(schema.cmPartnerships).set({ approvalAt: oldMoment }).where(eq(schema.cmPartnerships.id, apLate));
    check("…and not after ten minutes, even with the right moment", (await undoApproval(client.id, [apLate], decider, oldMoment.toISOString())).undone === 0);

    const ps = await add("__verify_un_pass");
    await db.update(schema.cmPartnerships).set({ clientApproval: "pending" }).where(eq(schema.cmPartnerships.id, ps));
    // An older note with the same words (an earlier pass) must survive this Undo, west of UTC too.
    await db.insert(schema.cmOutreachEvents).values({ partnershipId: ps, direction: "outbound", channel: "other", kind: "note", body: "Passed on by __verify Sam: an earlier pass", createdAt: new Date(Date.now() - 3 * 3_600_000) });
    const p1 = await pass(client.id, ps, decider, "Not a fit");
    check("Pass closes it and says what to undo it with", p1.ok && (await stageOf(ps)) === "passed" && !!p1.transitionId);
    check("a teammate with the same name can't undo your pass", !(await undoPass(client.id, ps, namesake, p1.transitionId ?? "")).ok && (await stageOf(ps)) === "passed");
    check("…nor a person at the client with the same name", !(await undoPass(client.id, ps, portalNamesake, p1.transitionId ?? "")).ok && (await stageOf(ps)) === "passed");
    check("the plain stage Undo can't take a pass apart (the approval would stay passed)", !(await undoMove(p1.transitionId ?? "", me.id)).ok && (await stageOf(ps)) === "passed");
    process.env.TZ = "America/Los_Angeles";
    const up = await undoPass(client.id, ps, decider, p1.transitionId ?? "");
    process.env.TZ = zone;
    if (zone === undefined) delete process.env.TZ;
    const [psRow] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, ps));
    const psNotes = (await notesOf(ps)).map((n) => n.body);
    check("Undo reopens it where it was, waiting for approval, and removes only this pass's note", up.ok && psRow.stage === "shortlisted" && psRow.clientApproval === "pending" && psRow.exitReason === null && psNotes.length === 1 && psNotes[0] === "Passed on by __verify Sam: an earlier pass", JSON.stringify({ up, s: psRow.stage, a: psRow.clientApproval, x: psRow.exitReason, psNotes }));
    check("…once", !(await undoPass(client.id, ps, decider, p1.transitionId ?? "")).ok);
    const psLate = await add("__verify_un_pass_late");
    await db.update(schema.cmPartnerships).set({ clientApproval: "pending" }).where(eq(schema.cmPartnerships.id, psLate));
    const p2 = await pass(client.id, psLate, decider, null);
    if (p2.transitionId) await db.update(schema.cmStageTransitions).set({ changedAt: new Date(Date.now() - UNDO_WINDOW_MS - 60_000) }).where(eq(schema.cmStageTransitions.id, p2.transitionId));
    check("…and a pass can't be undone after ten minutes", !(await undoPass(client.id, psLate, decider, p2.transitionId ?? "")).ok && (await stageOf(psLate)) === "passed");
  } finally {
    if (creatorIds.length) await db.delete(schema.cmCreators).where(inArray(schema.cmCreators.id, creatorIds));
    await db.delete(schema.cmCampaigns).where(inArray(schema.cmCampaigns.id, [campaignId, campaignB]));
  }
  check("test rows cleaned up", (await db.select().from(schema.cmCampaigns).where(inArray(schema.cmCampaigns.id, [campaignId, campaignB]))).length === 0);
}

async function main() {
  pure();
  await live();
}

main().then(
  () => {
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
