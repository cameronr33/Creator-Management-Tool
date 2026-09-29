import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { cmOutreachEvents, cmStageTransitions, users, type CmStage } from "@/lib/db/schema";
import { AUTO_TRIGGER_PAST, stageLabel } from "@/lib/stages";
import { shortDate } from "@/lib/format";
import type { AutoStageTrigger } from "@/lib/auto-stage";

/**
 * A creator's stage history: every move, who or what made it and why, and
 * which were undone (owner, 2026-09-28: "stage history"). Read from
 * cm_stage_transitions — the same rows the engines write — so it can't drift
 * from what happened. buildHistory is pure (scripts/verify-history.ts).
 */

export interface HistoryRow {
  id: string;
  fromStage: CmStage | null;
  toStage: CmStage;
  changedAt: Date;
  source: string | null;
  reason: string | null;
  meta: Record<string, unknown> | null;
  undoneAt: Date | null;
  /** The teammate who made the move (manual moves, or whose save set a rule off). */
  byName: string | null;
  /** The message behind it: an email the reader quoted, or a message a teammate logged. */
  evidence: { occurredAt: Date; synced: boolean; loggedByName: string | null } | null;
}

export async function getStageHistory(partnershipId: string): Promise<HistoryRow[]> {
  const logger = alias(users, "logger");
  const rows = await db
    .select({
      t: cmStageTransitions,
      byName: users.name,
      evidenceAt: cmOutreachEvents.occurredAt,
      evidenceExternalId: cmOutreachEvents.externalId,
      loggedByName: logger.name,
    })
    .from(cmStageTransitions)
    .leftJoin(users, eq(users.id, cmStageTransitions.changedBy))
    .leftJoin(cmOutreachEvents, eq(cmOutreachEvents.id, cmStageTransitions.evidenceEventId))
    .leftJoin(logger, eq(logger.id, cmOutreachEvents.createdBy))
    .where(eq(cmStageTransitions.partnershipId, partnershipId))
    .orderBy(desc(cmStageTransitions.changedAt));
  return rows.map((r) => ({
    id: r.t.id,
    fromStage: r.t.fromStage,
    toStage: r.t.toStage,
    changedAt: r.t.changedAt,
    source: r.t.source,
    reason: r.t.reason,
    meta: (r.t.meta as Record<string, unknown> | null) ?? null,
    undoneAt: r.t.undoneAt,
    byName: r.byName ?? null,
    evidence: r.evidenceAt ? { occurredAt: r.evidenceAt, synced: !!r.evidenceExternalId, loggedByName: r.loggedByName ?? null } : null,
  }));
}

export interface HistoryItem {
  id: string;
  from: CmStage | null;
  to: CmStage;
  at: Date;
  /** Who or what moved it, in plain words. */
  who: string;
  /** Their words: the line of email that moved it, or the note with a pass. */
  quote: string | null;
  /** Set when the move was later undone. */
  undone: { at: Date; by: string } | null;
  /** The latest move made from email that can still be undone (it gets an Undo button). */
  undoable: boolean;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Pure: who or what made one move. */
export function whoMoved(r: HistoryRow, clientName: string): string {
  const by = r.byName;
  if (r.fromStage === null) return `Added as ${stageLabel(r.toStage)}${by ? ` · ${by}` : ""}`;
  if (r.reason === "undo") return `Undo${by ? ` · ${by}` : ""}`;
  const continued = str(r.meta?.continuedFrom) ? " · the address was already on file, so straight to Ready to ship" : "";
  switch (r.source) {
    case "rule": {
      const trigger = (str(r.meta?.trigger) ?? r.reason ?? "") as AutoStageTrigger;
      const why = AUTO_TRIGGER_PAST[trigger] ?? "a rule applied";
      const portal = str(r.meta?.byClient);
      const tail = portal
        ? ` · ${portal} at ${clientName}, in their portal`
        : r.evidence?.synced
          ? " · in their email"
          : r.evidence?.loggedByName
            ? ` · logged by ${r.evidence.loggedByName}`
            : by
              ? ` · ${by}`
              : "";
      return `By itself when ${why}${tail}${continued}`;
    }
    case "email":
      return `From their email${r.evidence ? ` of ${shortDate(r.evidence.occurredAt)}` : ""}${continued}`;
    case "client":
      return `${str(r.meta?.decidedBy) ?? "Someone"} at ${clientName}, in their portal`;
    case "migration":
      return "When the stages were simplified";
    default:
      // "manual", or a row from before sources were recorded (read as a person's).
      return `${by ?? "A teammate"}${continued}`;
  }
}

/**
 * Pure: the history, newest first. An undo folds into the move it undid
 * ("Undone by Kieran"), so the list reads as what happened, not as pairs.
 */
export function buildHistory(rows: HistoryRow[], opts: { clientName: string; undoableId?: string | null }): HistoryItem[] {
  const ids = new Set(rows.map((r) => r.id));
  const undoOf = (r: HistoryRow) => (r.reason === "undo" ? str(r.meta?.undoOf) : null);
  const undoRows = new Map<string, HistoryRow>();
  for (const r of rows) {
    const target = undoOf(r);
    if (target && ids.has(target)) undoRows.set(target, r);
  }
  return rows
    .filter((r) => {
      const target = undoOf(r);
      return !(target && ids.has(target));
    })
    .map((r) => {
      const u = undoRows.get(r.id);
      const quote = r.source === "email" ? str(r.reason) : r.source === "client" && r.reason !== "client passed" ? str(r.reason) : null;
      return {
        id: r.id,
        from: r.fromStage,
        to: r.toStage,
        at: r.changedAt,
        who: whoMoved(r, opts.clientName),
        quote,
        undone: u ? { at: u.changedAt, by: u.byName ?? "a teammate" } : r.undoneAt ? { at: r.undoneAt, by: "a teammate" } : null,
        undoable: !!opts.undoableId && r.id === opts.undoableId && !r.undoneAt,
      };
    });
}
