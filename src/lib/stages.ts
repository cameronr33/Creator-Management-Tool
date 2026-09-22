import type { CmStage } from "@/lib/db/schema";
import type { AutoStageTrigger } from "@/lib/auto-stage";

/**
 * Single source of truth for how stages are labelled, ordered and grouped.
 * The stage answers one question — what is this partnership waiting on right
 * now — so shipping/post/contract facts are deliberately absent from it.
 *
 * Labels are written for a teammate on day one ("We passed" / "They
 * declined" says who ended it; "Waiting on video" says what's next). The
 * enum values underneath never change.
 */

export type StageGroup = "research" | "outreach" | "deal" | "fulfilment" | "closed";

export interface StageMeta {
  value: CmStage;
  label: string;
  group: StageGroup;
  /** One-line explanation, shown as a tooltip on pills and under the stage control. */
  hint: string;
  /** Terminal stages leave the working board and collapse into "Closed". */
  terminal: boolean;
}

export const STAGES: StageMeta[] = [
  {
    value: "researched",
    label: "Researched",
    group: "research",
    hint: "Found by a research run. Nobody has decided whether to reach out yet.",
    terminal: false,
  },
  {
    value: "shortlisted",
    label: "Shortlisted",
    group: "research",
    hint: "Approved for outreach. Nothing sent yet — they appear on Today under To contact.",
    terminal: false,
  },
  {
    value: "contacted",
    label: "Contacted",
    group: "outreach",
    hint: "First message sent. Waiting on a reply; follow-ups come due automatically.",
    terminal: false,
  },
  {
    value: "in_conversation",
    label: "In conversation",
    group: "outreach",
    hint: "They replied and are interested. No terms discussed yet.",
    terminal: false,
  },
  {
    value: "negotiating",
    label: "Negotiating",
    group: "outreach",
    hint: "Terms are on the table — fee, product scope, how many videos.",
    terminal: false,
  },
  {
    value: "agreed",
    label: "Agreed",
    group: "deal",
    hint: "They're in. Whether it's verbal or signed is recorded on the agreement, not the stage.",
    terminal: false,
  },
  {
    value: "awaiting_address",
    label: "Awaiting address",
    group: "deal",
    hint: "Agreed, but we still need a shipping address before anything can move.",
    terminal: false,
  },
  {
    value: "fulfilling",
    label: "Shipping",
    group: "fulfilment",
    hint: "Address in hand. Ready / shipped / delivered is tracked on the shipment.",
    terminal: false,
  },
  {
    value: "content_pending",
    label: "Waiting on video",
    group: "fulfilment",
    hint: "Product delivered and brief sent. Waiting on the creator to post.",
    terminal: false,
  },
  {
    value: "posted",
    label: "Posted",
    group: "fulfilment",
    hint: "At least one video is live.",
    terminal: false,
  },
  {
    value: "completed",
    label: "Completed",
    group: "fulfilment",
    hint: "Everything agreed has been delivered. Nothing left to do.",
    terminal: false,
  },
  {
    value: "passed",
    label: "We passed",
    group: "closed",
    hint: "We ended it — wrong fit, too expensive, out of budget.",
    terminal: true,
  },
  {
    value: "declined",
    label: "They declined",
    group: "closed",
    hint: "They ended it — not interested, a competitor conflict, wanted more money.",
    terminal: true,
  },
  {
    value: "no_response",
    label: "No response",
    group: "closed",
    hint: "Went quiet after the follow-ups ran out. A late reply reopens them automatically.",
    terminal: true,
  },
];

export const STAGE_BY_VALUE = new Map(STAGES.map((s) => [s.value, s]));

export const ACTIVE_STAGES = STAGES.filter((s) => !s.terminal);
export const TERMINAL_STAGES = STAGES.filter((s) => s.terminal);

export const STAGE_GROUP_LABELS: Record<StageGroup, string> = {
  research: "Research",
  outreach: "Outreach",
  deal: "Deal",
  fulfilment: "Fulfilment",
  closed: "Closed",
};

export const STAGE_GROUP_ORDER: StageGroup[] = ["research", "outreach", "deal", "fulfilment", "closed"];

/** Stages in display order, bucketed by phase — for grouped selects and the Help page. */
export function stagesByGroup(): { group: StageGroup; label: string; stages: StageMeta[] }[] {
  return STAGE_GROUP_ORDER.map((group) => ({
    group,
    label: STAGE_GROUP_LABELS[group],
    stages: STAGES.filter((s) => s.group === group),
  }));
}

export function stageLabel(stage: CmStage): string {
  return STAGE_BY_VALUE.get(stage)?.label ?? stage;
}

export function stageHint(stage: CmStage): string {
  return STAGE_BY_VALUE.get(stage)?.hint ?? "";
}

export function stageGroup(stage: CmStage): StageGroup {
  return STAGE_BY_VALUE.get(stage)?.group ?? "research";
}

export function isTerminal(stage: CmStage): boolean {
  return STAGE_BY_VALUE.get(stage)?.terminal ?? false;
}

/** Position on the active ladder; terminal stages return -1. */
export function stageIndex(stage: CmStage): number {
  return ACTIVE_STAGES.findIndex((s) => s.value === stage);
}

/** True once a partnership has reached the point where a shipment must exist. */
export function requiresShipment(stage: CmStage): boolean {
  const i = stageIndex(stage);
  return i >= stageIndex("fulfilling");
}

/** True once a partnership must have at least one live deliverable. */
export function requiresDeliverable(stage: CmStage): boolean {
  const i = stageIndex(stage);
  return i >= stageIndex("posted");
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
  outbound_message: "a first message is logged (I messaged them, or an email found in the mailbox)",
  inbound_message: "the creator replies (logged by you, or found by the email sync)",
  address_complete: "a complete shipping address is saved",
  shipment_shipped: "the shipment is marked shipped",
  shipment_delivered: "the shipment is marked delivered",
  deliverable_added: "a posted video is added",
};

/** Tailwind classes per group — semantic tokens only, never raw palette colours. */
export const STAGE_GROUP_STYLES: Record<StageGroup, string> = {
  research: "bg-surface-2 text-text-muted ring-border-strong",
  outreach: "bg-info-soft text-info ring-info-line",
  deal: "bg-warn-soft text-warn ring-warn-line",
  fulfilment: "bg-good-soft text-good ring-good-line",
  closed: "bg-surface-2 text-text-faint ring-border",
};

export function stageStyle(stage: CmStage): string {
  return STAGE_GROUP_STYLES[stageGroup(stage)];
}
