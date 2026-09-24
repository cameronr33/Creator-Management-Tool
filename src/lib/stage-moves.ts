import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmDeliverables, cmPartnerships, cmShipments, type CmStage } from "@/lib/db/schema";
import { canonicalStage, isTerminal, requiresDeliverable, requiresShipment } from "@/lib/stages";
import { hasCompleteAddress } from "@/lib/address";
import { instagramShortcode } from "@/lib/csv";
import type { cmExitReasonEnum } from "@/lib/db/schema";

/**
 * The one place a partnership's stage changes. Manual moves (board, stage
 * control, bulk), the rule table (auto-stage.ts) and email reading all come
 * through here, so the stage can never drift from the records it summarises:
 *
 *  - Ready to ship or later always has a shipment row (one is created at
 *    "ready" only when none exists — existing records, duplicates included,
 *    are never touched), and Shipped means it went out: moving there marks
 *    the latest shipment shipped if it was still "ready" (Undo puts it back).
 *  - Posted always has a video: a move to Posted without one needs the link.
 *  - Agreed with a complete address on file continues straight to Ready to ship.
 *  - Every move writes a cm_stage_transitions row saying who moved it
 *    (manual / rule / email / migration), why, and what it created, so Undo
 *    can take it back.
 *
 * The write is a single statement (data-modifying CTEs) with a compare-and-
 * set on the stage it read, so a concurrent move can't be double-applied and
 * a half-finished move can't exist.
 */

export type ExitReason = (typeof cmExitReasonEnum.enumValues)[number];
export type StageMoveSource = "manual" | "rule" | "email" | "migration";

export interface StageMoveInput {
  partnershipId: string;
  to: CmStage;
  source: StageMoveSource;
  userId?: string | null;
  /** For the closed stages: why it ended. Undefined leaves it unchanged. */
  exitReason?: ExitReason | null;
  /** Plain-words why: the rule that fired, or the quote from the email. */
  reason?: string | null;
  evidenceEventId?: string | null;
  /** The posted video, when moving to Posted with no video recorded yet. */
  videoUrl?: string | null;
  /** Only move if the stage is still this (engines pass what they evaluated). */
  expectFrom?: CmStage;
  /** Extra facts to keep with the transition (e.g. which trigger fired). */
  meta?: Record<string, unknown>;
  /** Land exactly on `to` (Undo): no Agreed → Ready to ship continuation. */
  exact?: boolean;
}

export type StageMoveResult =
  | {
      status: "moved";
      from: CmStage;
      to: CmStage;
      transitionId: string;
      createdShipmentId: string | null;
      createdDeliverableId: string | null;
      /** True when an Agreed move continued to Ready to ship because the address was on file. */
      continued: boolean;
    }
  | { status: "unchanged"; stage: CmStage }
  | { status: "stale"; stage: CmStage }
  | { status: "needs_video"; stage: CmStage }
  | { status: "not_found" };

/** Pure: where a requested move actually lands. */
export function resolveTarget(requested: CmStage, facts: { addressComplete: boolean }): { to: CmStage; continued: boolean } {
  const to = canonicalStage(requested);
  if (to === "awaiting_address" && facts.addressComplete) return { to: "fulfilling", continued: true };
  return { to, continued: false };
}

export async function moveStage(input: StageMoveInput): Promise<StageMoveResult> {
  const [p] = await db
    .select({
      stage: cmPartnerships.stage,
      addressLine1: cmPartnerships.addressLine1,
      city: cmPartnerships.city,
      region: cmPartnerships.region,
      postalCode: cmPartnerships.postalCode,
    })
    .from(cmPartnerships)
    .where(eq(cmPartnerships.id, input.partnershipId))
    .limit(1);
  if (!p) return { status: "not_found" };

  const from = input.expectFrom ?? p.stage;
  if (p.stage !== from) return { status: "stale", stage: p.stage };

  const { to, continued } = input.exact
    ? { to: canonicalStage(input.to), continued: false }
    : resolveTarget(input.to, { addressComplete: hasCompleteAddress(p) });

  if (to === p.stage) {
    if (input.exitReason !== undefined) {
      await db
        .update(cmPartnerships)
        .set({ exitReason: input.exitReason, updatedAt: new Date() })
        .where(eq(cmPartnerships.id, input.partnershipId));
    }
    return { status: "unchanged", stage: p.stage };
  }

  const needVideo = requiresDeliverable(to)
    ? (await db.select({ id: cmDeliverables.id }).from(cmDeliverables).where(eq(cmDeliverables.partnershipId, input.partnershipId)).limit(1)).length === 0
    : false;
  const videoUrl = input.videoUrl?.trim() || null;
  if (needVideo && !videoUrl) return { status: "needs_video", stage: p.stage };
  const video = needVideo && videoUrl ? describeVideo(videoUrl) : null;

  const needShipment = requiresShipment(to);
  const markShipped = to === "shipped";
  const setExit = input.exitReason !== undefined;
  const clearExit = !isTerminal(to);
  const meta = {
    ...(input.meta ?? {}),
    ...(continued ? { continuedFrom: "awaiting_address", continuedReason: "address already on file" } : {}),
  };

  const result = await db.execute(sql`
    with moved as (
      update ${cmPartnerships}
      set stage = ${to}::cm_stage,
          exit_reason = case
            when ${setExit} then ${input.exitReason ?? null}::cm_exit_reason
            when ${clearExit} then null
            else exit_reason
          end,
          updated_at = now()
      where id = ${input.partnershipId} and stage = ${from}::cm_stage
      returning id
    ), ship as (
      insert into ${cmShipments} (partnership_id, status, shipped_at)
      select id, (case when ${markShipped} then 'shipped' else 'ready' end)::cm_shipment_status,
             case when ${markShipped} then now() end
      from moved
      where ${needShipment}
        and not exists (select 1 from ${cmShipments} s where s.partnership_id = ${input.partnershipId})
      returning id
    ), marked as (
      update ${cmShipments}
      set status = 'shipped', shipped_at = coalesce(shipped_at, now()), updated_at = now()
      where ${markShipped} and exists (select 1 from moved) and status = 'ready'
        and id = (select s.id from ${cmShipments} s where s.partnership_id = ${input.partnershipId} order by s.created_at desc limit 1)
      returning id
    ), vid as (
      insert into ${cmDeliverables} (partnership_id, platform, url, shortcode, posted_at)
      select id, ${video?.platform ?? "instagram"}::cm_platform, ${video?.url ?? ""}, ${video?.shortcode ?? null}, now()
      from moved
      where ${video !== null}
      returning id
    ), tr as (
      insert into cm_stage_transitions (partnership_id, from_stage, to_stage, changed_by, source, reason, evidence_event_id, meta)
      select id, ${from}::cm_stage, ${to}::cm_stage, ${input.userId ?? null}::uuid, ${input.source}, ${input.reason ?? null},
             ${input.evidenceEventId ?? null}::uuid,
             ${JSON.stringify(meta)}::jsonb
               || jsonb_strip_nulls(jsonb_build_object(
                    'createdShipmentId', (select id from ship),
                    'markedShippedId', (select id from marked),
                    'createdDeliverableId', (select id from vid)))
      from moved
      returning id
    )
    select (select id from moved) as moved_id,
           (select id from ship) as shipment_id,
           (select id from vid) as deliverable_id,
           (select id from tr) as transition_id
  `);

  const row = (result.rows[0] ?? {}) as {
    moved_id: string | null;
    shipment_id: string | null;
    deliverable_id: string | null;
    transition_id: string | null;
  };
  if (!row.moved_id || !row.transition_id) {
    const [now] = await db.select({ stage: cmPartnerships.stage }).from(cmPartnerships).where(eq(cmPartnerships.id, input.partnershipId)).limit(1);
    return now ? { status: "stale", stage: now.stage } : { status: "not_found" };
  }
  return {
    status: "moved",
    from,
    to,
    transitionId: row.transition_id,
    createdShipmentId: row.shipment_id,
    createdDeliverableId: row.deliverable_id,
    continued,
  };
}

/** Platform + shortcode for a pasted video link. The link itself is kept exactly as pasted. */
export function describeVideo(url: string): { url: string; platform: string; shortcode: string | null } {
  let host = "";
  try {
    host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    host = "";
  }
  const platform =
    host.endsWith("instagram.com") ? "instagram"
    : host.endsWith("tiktok.com") ? "tiktok"
    : host.endsWith("youtube.com") || host === "youtu.be" ? "youtube"
    : host.endsWith("facebook.com") || host === "fb.watch" ? "facebook"
    : host === "x.com" || host.endsWith("twitter.com") ? "x"
    : "other";
  return { url, platform, shortcode: instagramShortcode(url) };
}
