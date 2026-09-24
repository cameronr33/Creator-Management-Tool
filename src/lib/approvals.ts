import { and, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmClientSettings, cmCreators, cmOutreachEvents, cmPartnerships } from "@/lib/db/schema";
import { moveStage } from "@/lib/stage-moves";

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
export async function approve(clientId: string, ids: string[], by: Decider, note?: string | null): Promise<{ approved: number }> {
  const unique = [...new Set(ids)];
  if (!unique.length) return { approved: 0 };
  const done = await db
    .update(cmPartnerships)
    .set({ clientApproval: "approved", approvalByName: by.name, approvalAt: sql`now()`, approvalNote: note?.trim() || null, updatedAt: new Date() })
    .where(and(inArray(cmPartnerships.id, unique), ofClientSql(clientId), decidable(by, false)))
    .returning({ id: cmPartnerships.id });
  const targets = done.map((r) => r.id);
  await noteOnTimeline(targets, `Approved for outreach by ${by.name}${note?.trim() ? `: "${note.trim()}"` : ""}`, by);
  return { approved: targets.length };
}

/**
 * Pass on a creator: recorded as the client's (or our) decision and closed as
 * We passed · Client passed. The decision is taken first (conditionally); if
 * the stage then can't move (someone moved it meanwhile), it's put back.
 */
export async function pass(clientId: string, id: string, by: Decider, note?: string | null): Promise<{ ok: boolean }> {
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
    meta: { decidedBy: by.name, ...(by.clientUserId ? { clientUserId: by.clientUserId } : {}) },
  });
  if (r.status !== "moved") {
    await db
      .update(cmPartnerships)
      .set({ clientApproval: before.clientApproval, approvalByName: before.approvalByName, approvalAt: before.approvalAt, approvalNote: before.approvalNote })
      .where(eq(cmPartnerships.id, id));
    return { ok: false };
  }
  await noteOnTimeline([id], `Passed on by ${by.name}${note?.trim() ? `: "${note.trim()}"` : ""}`, by);
  return { ok: true };
}
