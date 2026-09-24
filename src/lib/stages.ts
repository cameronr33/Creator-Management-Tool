import type { CmStage } from "@/lib/db/schema";
import type { AutoStageTrigger } from "@/lib/auto-stage";

/**
 * Single source of truth for how stages are labelled, ordered and grouped.
 * The stage answers one question — what is this partnership waiting on right
 * now — so shipping/post/contract facts are deliberately absent from it.
 *
 * Eight active stages and three closed ones (owner decisions: 2026-09-22 —
 * "simplify the pipeline"; 2026-09-23 — "there should be a Ready to ship
 * status", so Shipping split into Ready to ship → Shipped). The Postgres enum still carries four retired
 * values (researched, negotiating, agreed, completed); nothing writes them,
 * `canonicalStage()` maps any straggler on read, and verify:invariants
 * asserts none remain. Labels are written for a teammate on day one, and
 * every `action` line is what Today, the board, Next: and /help tell people
 * to do — one table, so the explanation can't drift from the behaviour.
 */

export type StageGroup = "outreach" | "deal" | "fulfilment" | "closed";

export interface StageMeta {
  value: CmStage;
  label: string;
  group: StageGroup;
  /** What the stage means. Shown as a tooltip on pills and in /help. */
  hint: string;
  /** What you do while a creator is here. Board column hints, Today, /help. */
  action: string;
  /** Terminal stages leave the working board and collapse into "Closed". */
  terminal: boolean;
}

export const STAGES: StageMeta[] = [
  {
    value: "shortlisted",
    label: "To contact",
    group: "outreach",
    hint: "On the list. No message sent yet.",
    action: "Message them on Instagram or by email. After a DM, click I messaged them.",
    terminal: false,
  },
  {
    value: "contacted",
    label: "Contacted",
    group: "outreach",
    hint: "First message sent. Waiting on their reply.",
    action: "Wait for a reply. Today tells you when a follow-up is due.",
    terminal: false,
  },
  {
    value: "in_conversation",
    label: "Talking",
    group: "outreach",
    hint: "They replied. Working out whether they're in, and on what terms.",
    action: "Agree the product, fee and videos, and write them down under Deal.",
    terminal: false,
  },
  {
    value: "awaiting_address",
    label: "Agreed",
    group: "deal",
    hint: "They're in. Verbal or signed is recorded under Deal. Waiting on their shipping address.",
    action: "Get their shipping address. Saving it moves them to Ready to ship.",
    terminal: false,
  },
  {
    value: "fulfilling",
    label: "Ready to ship",
    group: "fulfilment",
    hint: "Agreed and the address is in hand. The product hasn't gone out yet.",
    action: "Get the product sent, then mark it shipped with the tracking number.",
    terminal: false,
  },
  {
    value: "shipped",
    label: "Shipped",
    group: "fulfilment",
    hint: "The product is on its way to them.",
    action: "Wait for it to arrive. Mark it delivered, or it moves on when they say it arrived.",
    terminal: false,
  },
  {
    value: "content_pending",
    label: "Waiting on video",
    group: "fulfilment",
    hint: "The product arrived. Waiting on them to post.",
    action: "Send the brief if they need one, then paste the video link when it's live.",
    terminal: false,
  },
  {
    value: "posted",
    label: "Posted",
    group: "fulfilment",
    hint: "At least one video is live.",
    action: "Check the video matches what was agreed. Nothing else to do.",
    terminal: false,
  },
  {
    value: "passed",
    label: "We passed",
    group: "closed",
    hint: "We ended it — wrong fit, too expensive, out of budget.",
    action: "Nothing to do. Reopen it by moving the stage if plans change.",
    terminal: true,
  },
  {
    value: "declined",
    label: "They declined",
    group: "closed",
    hint: "They ended it — not interested, a competitor conflict, wanted more money.",
    action: "Nothing to do. Reopen it by moving the stage if they come back.",
    terminal: true,
  },
  {
    value: "no_response",
    label: "No response",
    group: "closed",
    hint: "Went quiet after the follow-ups ran out. A reply from them reopens it.",
    action: "Nothing to do. If they write back, they move to Talking by themselves.",
    terminal: true,
  },
];

/**
 * Enum values that still exist in Postgres but are no longer used, and the
 * stage each one now means. Only ever read defensively — nothing writes them.
 */
export const RETIRED_STAGES: Partial<Record<CmStage, CmStage>> = {
  researched: "shortlisted",
  negotiating: "in_conversation",
  agreed: "awaiting_address",
  completed: "posted",
};

/** Map a stored stage to the one the app shows (identity for current stages). */
export function canonicalStage(stage: CmStage): CmStage {
  return RETIRED_STAGES[stage] ?? stage;
}

/** Stages a creator can be added at (later ones need shipment / video records first). */
export const STARTING_STAGES = ["shortlisted", "contacted", "in_conversation", "awaiting_address"] as const satisfies readonly CmStage[];

/** Every stage a person or an engine may set — for zod enums. */
export const STAGE_VALUES = STAGES.map((s) => s.value) as [CmStage, ...CmStage[]];

export const STAGE_BY_VALUE = new Map(STAGES.map((s) => [s.value, s]));

export const ACTIVE_STAGES = STAGES.filter((s) => !s.terminal);
export const TERMINAL_STAGES = STAGES.filter((s) => s.terminal);

/** stage → what you do there. Derived from STAGES so there is one table. */
export const STAGE_ACTIONS: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.value, s.action]));

export const STAGE_GROUP_LABELS: Record<StageGroup, string> = {
  outreach: "Reach out",
  deal: "Agree",
  fulfilment: "Ship & post",
  closed: "Closed",
};

export const STAGE_GROUP_ORDER: StageGroup[] = ["outreach", "deal", "fulfilment", "closed"];

/** Stages in display order, bucketed by phase — for grouped selects and the Help page. */
export function stagesByGroup(): { group: StageGroup; label: string; stages: StageMeta[] }[] {
  return STAGE_GROUP_ORDER.map((group) => ({
    group,
    label: STAGE_GROUP_LABELS[group],
    stages: STAGES.filter((s) => s.group === group),
  }));
}

export function stageLabel(stage: CmStage): string {
  return STAGE_BY_VALUE.get(canonicalStage(stage))?.label ?? stage;
}

export function stageHint(stage: CmStage): string {
  return STAGE_BY_VALUE.get(canonicalStage(stage))?.hint ?? "";
}

export function stageAction(stage: CmStage): string {
  return STAGE_BY_VALUE.get(canonicalStage(stage))?.action ?? "";
}

export function stageGroup(stage: CmStage): StageGroup {
  return STAGE_BY_VALUE.get(canonicalStage(stage))?.group ?? "outreach";
}

export function isTerminal(stage: CmStage): boolean {
  return STAGE_BY_VALUE.get(canonicalStage(stage))?.terminal ?? false;
}

/** Position on the active ladder; terminal stages return -1. */
export function stageIndex(stage: CmStage): number {
  const c = canonicalStage(stage);
  return ACTIVE_STAGES.findIndex((s) => s.value === c);
}

/** True once a partnership has reached the point where a shipment must exist. */
export function requiresShipment(stage: CmStage): boolean {
  return stageIndex(stage) >= stageIndex("fulfilling");
}

/** True once a partnership must have at least one live deliverable. */
export function requiresDeliverable(stage: CmStage): boolean {
  return stageIndex(stage) >= stageIndex("posted");
}

/** Exit reasons split by who actually ended it. */
export const EXIT_REASONS_BY_STAGE: Record<string, { value: string; label: string }[]> = {
  passed: [
    { value: "research_fit", label: "Didn't pass review" },
    { value: "below_cadence", label: "Posts too rarely" },
    { value: "wrong_pillar", label: "Wrong content type" },
    { value: "fee_too_high", label: "Fee too high" },
    { value: "budget", label: "Out of budget" },
    { value: "other", label: "Other" },
  ],
  declined: [
    { value: "not_interested", label: "Not interested" },
    { value: "competitor_conflict", label: "Competitor conflict" },
    { value: "wants_more_money", label: "Wants more money" },
    { value: "other", label: "Other" },
  ],
  no_response: [
    { value: "went_dark", label: "Stopped replying" },
    { value: "other", label: "Other" },
  ],
};

export function exitReasonLabel(value: string | null | undefined): string {
  if (!value) return "";
  for (const list of Object.values(EXIT_REASONS_BY_STAGE)) {
    const hit = list.find((r) => r.value === value);
    if (hit) return hit.label;
  }
  return value;
}

/**
 * How the auto-stage engine's triggers read to a person. Paired with
 * AUTO_STAGE_RULES so the Help page and the stage control describe exactly
 * what the engine does.
 */
export const AUTO_TRIGGER_LABELS: Record<AutoStageTrigger, string> = {
  outbound_message: "a first message goes out (I messaged them, or an email in the mailbox)",
  inbound_message: "they reply (They replied, or an email from them in the mailbox)",
  address_complete: "a complete shipping address is saved",
  shipment_shipped: "the shipment is marked shipped",
  shipment_delivered: "the shipment is marked delivered",
  deliverable_added: "a posted video is added",
};

/** Tailwind classes per group — semantic tokens only, never raw palette colours. */
export const STAGE_GROUP_STYLES: Record<StageGroup, string> = {
  outreach: "bg-info-soft text-info ring-info-line",
  deal: "bg-warn-soft text-warn ring-warn-line",
  fulfilment: "bg-good-soft text-good ring-good-line",
  closed: "bg-surface-2 text-text-faint ring-border",
};

export function stageStyle(stage: CmStage): string {
  return STAGE_GROUP_STYLES[stageGroup(stage)];
}
