import { and, desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmClientSettings, cmCreators, cmOutreachEvents, cmPartnerships, cmStageTransitions, type CmStage } from "@/lib/db/schema";
import { moveStage, type ExitReason } from "@/lib/stage-moves";

/**
 * The client's say on a creator before anyone reaches out (owner decision,
 * 2026-09-24). An attribute of the partnership, not a stage: approval never
 * moves a stage; passing closes the deal as We passed · "Client passed" —
 * a person's decision (the client's, or ours on their behalf), never
 * automation, so frozen node 2 is untouched. The agency and the client
 * portal both come through here.
 */

export interface Decider {
  /** Shown on the record: "Approved by Rob Tinson". */
  name: string;
  /** Who acted: a teammate (their users.id) or a person at the client. */
  kind: "agency" | "client";
  userId?: string | null;
  clientUserId?: string | null;
}

/** Does this client want to approve creators before outreach? */
export async function approvalRequired(clientId: string): Promise<boolean> {
  const [s] = await db.select({ on: cmClientSettings.requiresApproval }).from(cmClientSettings).where(eq(cmClientSettings.clientId, clientId)).limit(1);
  return !!s?.on;
}

export async function setApprovalRequired(clientId: string, on: boolean): Promise<void> {
  await db
    .insert(cmClientSettings)
    .values({ clientId, requiresApproval: on })
    .onConflictDoUpdate({ target: cmClientSettings.clientId, set: { requiresApproval: on, updatedAt: new Date() } });
}

/** Only this client's partnerships — anything else is never touched. */
const ofClientSql = (clientId: string) => inArray(cmPartnerships.creatorId, db.select({ id: cmCreators.id }).from(cmCreators).where(eq(cmCreators.clientId, clientId)));

/**
 * Who may decide on what (security review, 2026-09-24):
 *  - a client only on a creator still in To contact and waiting for them;
 *  - the agency on anyone still open who hasn't been passed on.
 * Each decision is one conditional UPDATE, so two people deciding at once
 * can't both win, and a stale page can't overwrite a newer decision.
 */
function decidable(by: Decider, forPass: boolean) {
  return by.kind === "client"
    ? and(eq(cmPartnerships.clientApproval, "pending"), eq(cmPartnerships.stage, "shortlisted"))
    : and(
        forPass ? sql`${cmPartnerships.clientApproval} is distinct from 'passed'` : or(isNull(cmPartnerships.clientApproval), eq(cmPartnerships.clientApproval, "pending")),
        notInArray(cmPartnerships.stage, ["passed", "declined", "no_response"]),
      );
}

/**
 * Who decided, as an identity — never a display name (review 2026-09-30: two
 * teammates can share a name, and a person at the client can have the same
 * name as a teammate). Null when we can't tell who it was: nothing is undoable then.
 */
function deciderKey(by: Decider): string | null {
  if (by.kind === "agency") return by.userId ? `agency:${by.userId}` : null;
  return by.clientUserId ? `client:${by.clientUserId}` : null;
}

/**
 * The timeline note a decision wrote — Undo takes it off again: only notes
 * with that wording from that moment on. The cutoff is sent as UTC text: a
 * JS Date would be sent in the laptop's local time and compared against the
 * UTC column (review 2026-09-30).
 */
async function removeDecisionNote(partnershipIds: string[], prefix: string, since: Date) {
  if (!partnershipIds.length) return;
  await db
    .delete(cmOutreachEvents)
    .where(
      and(
        inArray(cmOutreachEvents.partnershipId, partnershipIds),
        eq(cmOutreachEvents.kind, "note"),
        sql`left(${cmOutreachEvents.body}, ${prefix.length}) = ${prefix}`,
        sql`${cmOutreachEvents.createdAt} >= ${new Date(since.getTime() - 5_000).toISOString()}::timestamp`,
      ),
    );
}

async function noteOnTimeline(partnershipIds: string[], text: string, by: Decider) {
  if (!partnershipIds.length) return;
  await db.insert(cmOutreachEvents).values(
    partnershipIds.map((partnershipId) => ({
      partnershipId,
      direction: "outbound" as const,
      channel: "other" as const,
      kind: "note" as const,
      body: text,
      createdBy: by.kind === "agency" ? (by.userId ?? null) : null,
    })),
  );
}

/**
 * Approve for outreach — the client what's waiting for them, the agency anyone
 * still open. Records who decided (identity) and whether it was waiting, so
 * Undo can put back exactly that without asking the browser.
 */
export async function approve(clientId: string, ids: string[], by: Decider, note?: string | null): Promise<{ approved: number; decidedAt: string | null }> {
  const unique = [...new Set(ids)];
  if (!unique.length) return { approved: 0, decidedAt: null };
  const done = await db
    .update(cmPartnerships)
    .set({
      clientApproval: "approved",
      approvalByName: by.name,
      approvalAt: sql`now()`,
      approvalNote: note?.trim() || null,
      approvalDecider: deciderKey(by),
      // The right-hand side sees the row as it was: was it waiting?
      approvalWasPending: sql`coalesce(${cmPartnerships.clientApproval} = 'pending', false)`,
      updatedAt: new Date(),
    })
    .where(and(inArray(cmPartnerships.id, unique), ofClientSql(clientId), decidable(by, false)))
    .returning({ id: cmPartnerships.id, approvalAt: cmPartnerships.approvalAt });
  const targets = done.map((r) => r.id);
  await noteOnTimeline(targets, `Approved for outreach by ${by.name}${note?.trim() ? `: "${note.trim()}"` : ""}`, by);
  // One statement, one now(): every row shares the moment — what Undo matches on.
  return { approved: targets.length, decidedAt: done[0]?.approvalAt?.toISOString() ?? null };
}

export const DECISION_UNDO_WINDOW_MS = 10 * 60_000;

/**
 * Undo an approval (interaction review 2026-09-30, owner: I14): each back to
 * what it was — waiting for approval, or none asked, as recorded when it was
 * approved — only rows still approved by this same person (identity) at that
 * exact moment, within ten minutes, so a decision made since stands. One
 * statement; the timeline note goes too.
 */
export async function undoApproval(clientId: string, ids: string[], by: Decider, decidedAt: string): Promise<{ undone: number }> {
  const unique = [...new Set(ids)];
  const at = new Date(decidedAt);
  const who = deciderKey(by);
  if (!unique.length || !who || Number.isNaN(at.getTime())) return { undone: 0 };
  const done = await db
    .update(cmPartnerships)
    .set({
      clientApproval: sql`case when ${cmPartnerships.approvalWasPending} then 'pending'::cm_client_approval else null end`,
      approvalByName: null,
      approvalAt: null,
      approvalNote: null,
      approvalDecider: null,
      approvalWasPending: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(cmPartnerships.id, unique),
        ofClientSql(clientId),
        eq(cmPartnerships.clientApproval, "approved"),
        eq(cmPartnerships.approvalDecider, who),
        sql`date_trunc('milliseconds', ${cmPartnerships.approvalAt}) = ${at.toISOString()}::timestamp`,
        sql`${cmPartnerships.approvalAt} > now() - make_interval(secs => ${DECISION_UNDO_WINDOW_MS / 1000})`,
      ),
    )
    .returning({ id: cmPartnerships.id });
  await removeDecisionNote(done.map((r) => r.id), `Approved for outreach by ${by.name}`, at);
  return { undone: done.length };
}

type ApprovalFields = {
  clientApproval: "pending" | "approved" | "passed" | null;
  approvalByName: string | null;
  approvalAt: string | null;
  approvalNote: string | null;
  approvalDecider: string | null;
  approvalWasPending: boolean | null;
};

/**
 * Pass on a creator: recorded as the client's (or our) decision and closed as
 * We passed · Client passed. The decision is taken first (conditionally); if
 * the stage then can't move (someone moved it meanwhile), it's put back.
 */
export async function pass(clientId: string, id: string, by: Decider, note?: string | null): Promise<{ ok: boolean; transitionId?: string }> {
  const [before] = await db
    .select({
      stage: cmPartnerships.stage,
      clientApproval: cmPartnerships.clientApproval,
      approvalByName: cmPartnerships.approvalByName,
      approvalAt: cmPartnerships.approvalAt,
      approvalNote: cmPartnerships.approvalNote,
      approvalDecider: cmPartnerships.approvalDecider,
      approvalWasPending: cmPartnerships.approvalWasPending,
    })
    .from(cmPartnerships)
    .where(and(eq(cmPartnerships.id, id), ofClientSql(clientId)))
    .limit(1);
  if (!before) return { ok: false };
  const taken = await db
    .update(cmPartnerships)
    .set({ clientApproval: "passed", approvalByName: by.name, approvalAt: sql`now()`, approvalNote: note?.trim() || null, approvalDecider: deciderKey(by), updatedAt: new Date() })
    .where(and(eq(cmPartnerships.id, id), ofClientSql(clientId), eq(cmPartnerships.stage, before.stage), decidable(by, true)))
    .returning({ id: cmPartnerships.id });
  if (!taken.length) return { ok: false };
  const priorApproval: ApprovalFields = { ...before, approvalAt: before.approvalAt?.toISOString() ?? null };
  const r = await moveStage({
    partnershipId: id,
    to: "passed",
    source: by.kind === "client" ? "client" : "manual",
    userId: by.kind === "agency" ? (by.userId ?? null) : null,
    expectFrom: before.stage,
    exitReason: "client_passed",
    reason: note?.trim() || "client passed",
    meta: {
      decidedBy: by.name,
      decider: deciderKey(by),
      ...(by.clientUserId ? { clientUserId: by.clientUserId } : {}),
      // What Undo puts back (kept on the server, never taken from the browser).
      priorApproval,
    },
  });
  if (r.status !== "moved") {
    await db
      .update(cmPartnerships)
      .set({ clientApproval: before.clientApproval, approvalByName: before.approvalByName, approvalAt: before.approvalAt, approvalNote: before.approvalNote, approvalDecider: before.approvalDecider, approvalWasPending: before.approvalWasPending })
      .where(eq(cmPartnerships.id, id));
    return { ok: false };
  }
  await noteOnTimeline([id], `Passed on by ${by.name}${note?.trim() ? `: "${note.trim()}"` : ""}`, by);
  return { ok: true, transitionId: r.transitionId };
}

/**
 * Undo a pass (interaction review 2026-09-30, owner: I14): the deal reopens
 * where it was and the approval goes back to what it was — only the person who
 * passed (identity), within ten minutes, while the pass is still the latest
 * move and the approval still theirs. The approval is put back first
 * (compare-and-set), then the stage (compare-and-set); if the stage can't
 * move, the approval is set back exactly as the pass left it, so it's all or
 * nothing. A person's move, reason "undo".
 */
export async function undoPass(clientId: string, id: string, by: Decider, transitionId: string, now = new Date()): Promise<{ ok: true; stage: CmStage } | { ok: false; error: string }> {
  const fail = (error: string) => ({ ok: false as const, error });
  const who = deciderKey(by);
  const [t] = await db.select().from(cmStageTransitions).where(eq(cmStageTransitions.id, transitionId)).limit(1);
  if (!who || !t || t.partnershipId !== id || t.toStage !== "passed" || !t.fromStage || t.undoneAt) return fail("That pass can't be undone any more.");
  const meta = (t.meta ?? {}) as { decider?: string | null; priorExitReason?: string | null; priorApproval?: ApprovalFields };
  if (meta.decider !== who) return fail("Only the person who passed can undo it.");
  if (by.kind === "agency" && t.changedBy !== by.userId) return fail("Only the person who passed can undo it.");
  if (now.getTime() - t.changedAt.getTime() > DECISION_UNDO_WINDOW_MS) return fail("That was more than ten minutes ago — reopen it by hand instead.");
  const [latest] = await db.select({ id: cmStageTransitions.id }).from(cmStageTransitions).where(eq(cmStageTransitions.partnershipId, id)).orderBy(desc(cmStageTransitions.changedAt)).limit(1);
  if (latest?.id !== t.id) return fail("The stage has moved since — change it by hand instead.");
  const [asPassed] = await db
    .select({ approvalByName: cmPartnerships.approvalByName, approvalAt: cmPartnerships.approvalAt, approvalNote: cmPartnerships.approvalNote })
    .from(cmPartnerships)
    .where(eq(cmPartnerships.id, id))
    .limit(1);
  const prior = meta.priorApproval ?? { clientApproval: "pending" as const, approvalByName: null, approvalAt: null, approvalNote: null, approvalDecider: null, approvalWasPending: null };
  const restored = await db
    .update(cmPartnerships)
    .set({
      clientApproval: prior.clientApproval,
      approvalByName: prior.approvalByName,
      approvalAt: prior.approvalAt ? new Date(prior.approvalAt) : null,
      approvalNote: prior.approvalNote,
      approvalDecider: prior.approvalDecider,
      approvalWasPending: prior.approvalWasPending,
      updatedAt: new Date(),
    })
    .where(and(eq(cmPartnerships.id, id), ofClientSql(clientId), eq(cmPartnerships.stage, "passed"), eq(cmPartnerships.clientApproval, "passed"), eq(cmPartnerships.approvalDecider, who)))
    .returning({ id: cmPartnerships.id });
  if (!restored.length) return fail("That pass can't be undone any more.");
  const r = await moveStage({
    partnershipId: id,
    to: t.fromStage,
    source: by.kind === "client" ? "client" : "manual",
    userId: by.kind === "agency" ? (by.userId ?? null) : null,
    expectFrom: "passed",
    exact: true,
    exitReason: (meta.priorExitReason ?? null) as ExitReason | null,
    reason: "undo",
    meta: { undoOf: t.id },
  });
  if (r.status !== "moved") {
    // Put the pass back exactly as it was.
    await db
      .update(cmPartnerships)
      .set({ clientApproval: "passed", approvalByName: asPassed?.approvalByName ?? by.name, approvalAt: asPassed?.approvalAt ?? t.changedAt, approvalNote: asPassed?.approvalNote ?? null, approvalDecider: who })
      .where(eq(cmPartnerships.id, id));
    return fail("The stage has changed since — change it by hand instead.");
  }
  await db.update(cmStageTransitions).set({ undoneAt: new Date() }).where(eq(cmStageTransitions.id, t.id));
  await removeDecisionNote([id], `Passed on by ${by.name}`, t.changedAt);
  return { ok: true, stage: t.fromStage };
}
