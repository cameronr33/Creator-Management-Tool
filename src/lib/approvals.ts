import { and, eq, inArray, sql } from "drizzle-orm";
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

/** Partnerships of this client (the rest are ignored — never touched across clients). */
async function ofClient(clientId: string, ids: string[]): Promise<{ id: string; clientApproval: string | null; stage: string }[]> {
  if (!ids.length) return [];
  return db
    .select({ id: cmPartnerships.id, clientApproval: cmPartnerships.clientApproval, stage: cmPartnerships.stage })
    .from(cmPartnerships)
    .innerJoin(cmCreators, eq(cmCreators.id, cmPartnerships.creatorId))
    .where(and(inArray(cmPartnerships.id, [...new Set(ids)]), eq(cmCreators.clientId, clientId)));
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
 * Approve for outreach. The agency may approve anyone (on the client's
 * behalf); the client only what's waiting for them.
 */
export async function approve(clientId: string, ids: string[], by: Decider, note?: string | null): Promise<{ approved: number }> {
  const rows = (await ofClient(clientId, ids)).filter((r) => (by.kind === "client" ? r.clientApproval === "pending" : r.clientApproval !== "approved"));
  const targets = rows.map((r) => r.id);
  if (!targets.length) return { approved: 0 };
  await db
    .update(cmPartnerships)
    .set({ clientApproval: "approved", approvalByName: by.name, approvalAt: sql`now()`, approvalNote: note?.trim() || null, updatedAt: new Date() })
    .where(inArray(cmPartnerships.id, targets));
  await noteOnTimeline(targets, `Approved for outreach by ${by.name}${note?.trim() ? `: "${note.trim()}"` : ""}`, by);
  return { approved: targets.length };
}

/**
 * Pass on a creator: recorded as the client's (or our) decision and closed as
 * We passed · Client passed. The client can only pass on what's waiting for them.
 */
export async function pass(clientId: string, id: string, by: Decider, note?: string | null): Promise<{ ok: boolean }> {
  const [row] = await ofClient(clientId, [id]);
  if (!row || (by.kind === "client" && row.clientApproval !== "pending")) return { ok: false };
  await db
    .update(cmPartnerships)
    .set({ clientApproval: "passed", approvalByName: by.name, approvalAt: sql`now()`, approvalNote: note?.trim() || null, updatedAt: new Date() })
    .where(eq(cmPartnerships.id, id));
  await noteOnTimeline([id], `Passed on by ${by.name}${note?.trim() ? `: "${note.trim()}"` : ""}`, by);
  const r = await moveStage({
    partnershipId: id,
    to: "passed",
    source: by.kind === "client" ? "client" : "manual",
    userId: by.kind === "agency" ? (by.userId ?? null) : null,
    exitReason: "client_passed",
    reason: note?.trim() || "client passed",
    meta: { decidedBy: by.name, ...(by.clientUserId ? { clientUserId: by.clientUserId } : {}) },
  });
  return { ok: r.status === "moved" || r.status === "unchanged" };
}
