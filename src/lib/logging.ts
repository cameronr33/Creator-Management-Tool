import { db } from "@/lib/db";
import { cmOutreachEvents } from "@/lib/db/schema";
import { applyAutoStage, type AutoStageResult } from "@/lib/auto-stage";
import { lastManualChangeAt } from "@/lib/email-ingest";
import { resolveOccurredAt } from "@/lib/log-time";
import { recordQuickAction, type QuickUndo } from "@/lib/quick-actions";

/**
 * Logging a message by hand — a DM, a call, an email from a teammate's own
 * inbox — with when it actually happened (owner, 2026-09-28: "when + how on
 * logging"), so follow-up clocks stay right when a batch is logged the next
 * morning.
 *
 * A date earlier than a person's last stage change doesn't move the stage
 * (the email check's rule): an old reply logged late must not reopen a deal
 * someone closed since (frozen node 2). Every log can be undone for ten
 * minutes by whoever logged it (src/lib/quick-actions.ts).
 */

export { LOG_MAX_PAST_DAYS, resolveOccurredAt, type ResolvedTime } from "@/lib/log-time";

export interface LogInput {
  partnershipId: string;
  direction: "inbound" | "outbound";
  channel: "ig_dm" | "email" | "phone" | "other";
  kind: "initial" | "follow_up" | "reply" | "note";
  body?: string | null;
  subject?: string | null;
  occurredAt?: string | null;
}

export type LogResult =
  | { ok: true; eventId: string; stageChanged: AutoStageResult | null; stageSkipped: boolean; undo: QuickUndo }
  | { ok: false; error: string };

export async function logMessage(input: LogInput, userId: string, now = new Date()): Promise<LogResult> {
  const when = resolveOccurredAt(input.occurredAt, now);
  if (!when.ok) return when;
  const [row] = await db
    .insert(cmOutreachEvents)
    .values({
      partnershipId: input.partnershipId,
      direction: input.direction,
      channel: input.channel,
      kind: input.kind,
      body: input.body?.trim() || null,
      subject: input.subject?.trim() || null,
      occurredAt: when.at,
      createdBy: userId,
    })
    .returning({ id: cmOutreachEvents.id });

  // A first message implies Contacted; their reply implies Talking. Notes never move the stage.
  const trigger =
    input.direction === "inbound" && input.kind === "reply"
      ? ("inbound_message" as const)
      : input.direction === "outbound" && (input.kind === "initial" || input.kind === "follow_up")
        ? ("outbound_message" as const)
        : null;
  let stageChanged: AutoStageResult | null = null;
  let stageSkipped = false;
  if (trigger && when.supplied) {
    const decided = (await lastManualChangeAt([input.partnershipId], { forLogging: true })).get(input.partnershipId);
    stageSkipped = !!decided && when.at.getTime() <= decided.getTime();
  }
  if (trigger && !stageSkipped) stageChanged = await applyAutoStage(input.partnershipId, trigger, userId, { evidenceEventId: row.id });
  const actionId = await recordQuickAction({
    partnershipId: input.partnershipId,
    kind: "message",
    userId,
    outreachEventId: row.id,
    transitionId: stageChanged?.transitionId ?? null,
  });
  return { ok: true, eventId: row.id, stageChanged, stageSkipped, undo: { actionId, partnershipId: input.partnershipId } };
}
