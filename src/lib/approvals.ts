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

/** The timeline note a decision wrote — Undo takes it off again (only notes from that moment, by that name). */
async function removeDecisionNote(partnershipIds: string[], prefix: string, since: Date) {
  if (!partnershipIds.length) return;
  await db
    .delete(cmOutreachEvents)
    .where(
      and(
        inArray(cmOutreachEvents.partnershipId, partnershipIds),
        eq(cmOutreachEvents.kind, "note"),
        sql`left(${cmOutreachEvents.body}, ${prefix.length}) = ${prefix}`,
        sql`${cmOutreachEvents.createdAt} >= ${new Date(since.getTime() - 5_000)}`,
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

/** Approve for outreach — the client what's waiting for them, the agency anyone still open. */
export type PriorApproval = { id: string; clientApproval: "pending" | null };

export async function approve(clientId: string, ids: string[], by: Decider, note?: string | null): Promise<{ approved: number; decidedAt: string | null; prior: PriorApproval[] }> {
  const unique = [...new Set(ids)];
  if (!unique.length) return { approved: 0, decidedAt: null, prior: [] };
  // What each was before (waiting, or none asked) — what Undo puts back.
  const before = await db
    .select({ id: cmPartnerships.id, clientApproval: cmPartnerships.clientApproval })
    .from(cmPartnerships)
    .where(and(inArray(cmPartnerships.id, unique), ofClientSql(clientId), decidable(by, false)));
  const done = await db
    .update(cmPartnerships)
    .set({ clientApproval: "approved", approvalByName: by.name, approvalAt: sql`now()`, approvalNote: note?.trim() || null, updatedAt: new Date() })
    .where(and(inArray(cmPartnerships.id, unique), ofClientSql(clientId), decidable(by, false)))
    .returning({ id: cmPartnerships.id, approvalAt: cmPartnerships.approvalAt });
  const targets = done.map((r) => r.id);
  await noteOnTimeline(targets, `Approved for outreach by ${by.name}${note?.trim() ? `: "${note.trim()}"` : ""}`, by);
  // One statement, one now(): every row shares the moment — what Undo matches on.
  const was = new Map(before.map((b) => [b.id, b.clientApproval === "pending" ? ("pending" as const) : null]));
  return { approved: targets.length, decidedAt: done[0]?.approvalAt?.toISOString() ?? null, prior: targets.map((id) => ({ id, clientApproval: was.get(id) ?? null })) };
}

export const DECISION_UNDO_WINDOW_MS = 10 * 60_000;

/**
 * Undo an approval (interaction review 2026-09-30, owner: I14): each back to
 * what it was (waiting for approval, or none asked — the only two values
 * `prior` can hold) — only rows still approved by this person at that exact
 * moment, within ten minutes, so a decision made since stands. One
 * statement; the timeline note goes too.
 */
export async function undoApproval(clientId: string, prior: PriorApproval[], by: Decider, decidedAt: string): Promise<{ undone: number }> {
  const at = new Date(decidedAt);
  const rows = prior.filter((p) => p.clientApproval === "pending" || p.clientApproval === null);
  if (!rows.length || Number.isNaN(at.getTime())) return { undone: 0 };
  const values = sql.join(rows.map((p) => sql`(${p.id}::uuid, ${p.clientApproval}::cm_client_approval)`), sql`, `);
  const res = await db.execute(sql`
    update ${cmPartnerships} set client_approval = v.prior, approval_by_name = null, approval_at = null, approval_note = null, updated_at = now()
    from (values ${values}) as v(id, prior)
    where ${cmPartnerships.id} = v.id
      and ${ofClientSql(clientId)}
      and ${cmPartnerships.clientApproval} = 'approved'
      and ${cmPartnerships.approvalByName} = ${by.name}
      and date_trunc('milliseconds', ${cmPartnerships.approvalAt}) = ${at.toISOString()}::timestamp
      and ${cmPartnerships.approvalAt} > now() - make_interval(secs => ${DECISION_UNDO_WINDOW_MS / 1000})
    returning ${cmPartnerships.id} as id
  `);
  const undone = (res.rows as { id: string }[]).map((r) => r.id);
  await removeDecisionNote(undone, `Approved for outreach by ${by.name}`, at);
  return { undone: undone.length };
}

/**
 * Pass on a creator: recorded as the client's (or our) decision and closed as
 * We passed · Client passed. The decision is taken first (conditionally); if
 * the stage then can't move (someone moved it meanwhile), it's put back.
 */
export async function pass(clientId: string, id: string, by: Decider, note?: string | null): Promise<{ ok: boolean; transitionId?: string }> {
  const [before] = await db
    .select({ stage: cmPartnerships.stage, clientApproval: cmPartnerships.clientApproval, approvalByName: cmPartnerships.approvalByName, approvalAt: cmPartnerships.approvalAt, approvalNote: cmPartnerships.approvalNote })
    .from(cmPartnerships)
    .where(and(eq(cmPartnerships.id, id), ofClientSql(clientId)))
    .limit(1);
  if (!before) return { ok: false };
  const taken = await db
    .update(cmPartnerships)
    .set({ clientApproval: "passed", approvalByName: by.name, approvalAt: sql`now()`, approvalNote: note?.trim() || null, updatedAt: new Date() })
    .where(and(eq(cmPartnerships.id, id), ofClientSql(clientId), eq(cmPartnerships.stage, before.stage), decidable(by, true)))
    .returning({ id: cmPartnerships.id });
  if (!taken.length) return { ok: false };
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
      ...(by.clientUserId ? { clientUserId: by.clientUserId } : {}),
      // What Undo puts back (kept on the server, never taken from the browser).
      priorApproval: { clientApproval: before.clientApproval, approvalByName: before.approvalByName, approvalAt: before.approvalAt?.toISOString() ?? null, approvalNote: before.approvalNote },
    },
  });
  if (r.status !== "moved") {
    await db
      .update(cmPartnerships)
      .set({ clientApproval: before.clientApproval, approvalByName: before.approvalByName, approvalAt: before.approvalAt, approvalNote: before.approvalNote })
      .where(eq(cmPartnerships.id, id));
    return { ok: false };
  }
  await noteOnTimeline([id], `Passed on by ${by.name}${note?.trim() ? `: "${note.trim()}"` : ""}`, by);
  return { ok: true, transitionId: r.transitionId };
}

/**
 * Undo a pass (interaction review 2026-09-30, owner: I14): the deal reopens
 * where it was and the approval goes back to what it was — only the person who
 * passed, within ten minutes, while the pass is still the latest move and the
 * approval still theirs. The approval is put back first (compare-and-set),
 * then the stage (compare-and-set); if the stage can't move, the approval is
 * set back to passed, so it's all or nothing. A person's move, reason "undo".
 */
export async function undoPass(clientId: string, id: string, by: Decider, transitionId: string, now = new Date()): Promise<{ ok: true; stage: CmStage } | { ok: false; error: string }> {
  const fail = (error: string) => ({ ok: false as const, error });
  const [t] = await db.select().from(cmStageTransitions).where(eq(cmStageTransitions.id, transitionId)).limit(1);
  if (!t || t.partnershipId !== id || t.toStage !== "passed" || !t.fromStage || t.undoneAt) return fail("That pass can't be undone any more.");
  const meta = (t.meta ?? {}) as { decidedBy?: string; priorExitReason?: string | null; priorApproval?: { clientApproval: "pending" | "approved" | "passed" | null; approvalByName: string | null; approvalAt: string | null; approvalNote: string | null } };
  if (meta.decidedBy !== by.name) return fail("Only the person who passed can undo it.");
  if (now.getTime() - t.changedAt.getTime() > DECISION_UNDO_WINDOW_MS) return fail("That was more than ten minutes ago — reopen it by hand instead.");
  const [latest] = await db.select({ id: cmStageTransitions.id }).from(cmStageTransitions).where(eq(cmStageTransitions.partnershipId, id)).orderBy(desc(cmStageTransitions.changedAt)).limit(1);
  if (latest?.id !== t.id) return fail("The stage has moved since — change it by hand instead.");
  const prior = meta.priorApproval ?? { clientApproval: "pending" as const, approvalByName: null, approvalAt: null, approvalNote: null };
  const restored = await db
    .update(cmPartnerships)
    .set({ clientApproval: prior.clientApproval, approvalByName: prior.approvalByName, approvalAt: prior.approvalAt ? new Date(prior.approvalAt) : null, approvalNote: prior.approvalNote, updatedAt: new Date() })
    .where(and(eq(cmPartnerships.id, id), ofClientSql(clientId), eq(cmPartnerships.stage, "passed"), eq(cmPartnerships.clientApproval, "passed"), eq(cmPartnerships.approvalByName, by.name)))
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
    await db.update(cmPartnerships).set({ clientApproval: "passed", approvalByName: by.name, approvalAt: t.changedAt }).where(eq(cmPartnerships.id, id));
    return fail("The stage has changed since — change it by hand instead.");
  }
  await db.update(cmStageTransitions).set({ undoneAt: new Date() }).where(eq(cmStageTransitions.id, t.id));
  await removeDecisionNote([id], `Passed on by ${by.name}`, t.changedAt);
  return { ok: true, stage: t.fromStage };
}
