import type { CmStage } from "@/lib/db/schema";

/**
 * Single source of truth for how stages are labelled, ordered and grouped.
 * The stage answers one question — what is this partnership waiting on right
 * now — so shipping/post/contract facts are deliberately absent from it.
 */

export type StageGroup = "research" | "outreach" | "deal" | "fulfilment" | "closed";

export interface StageMeta {
  value: CmStage;
  label: string;
  group: StageGroup;
  /** One-line explanation surfaced as a tooltip on the board. */
  hint: string;
  /** Terminal stages leave the working board and collapse into "Closed". */
  terminal: boolean;
}

export const STAGES: StageMeta[] = [
  {
    value: "researched",
    label: "Researched",
    group: "research",
    hint: "In the system from a research run. No decision made yet.",
    terminal: false,
  },
  {
    value: "shortlisted",
    label: "Shortlisted",
    group: "research",
    hint: "Approved for outreach. Nothing sent yet.",
    terminal: false,
  },
  {
    value: "contacted",
    label: "Contacted",
    group: "outreach",
    hint: "First message sent. Waiting on a reply.",
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
    hint: "Terms are on the table — fee, product scope, deliverable count.",
    terminal: false,
  },
  {
    value: "agreed",
    label: "Agreed",
    group: "deal",
    hint: "They're in. Verbal or signed is recorded on the agreement, not the stage.",
    terminal: false,
  },
  {
    value: "awaiting_address",
    label: "Awaiting address",
    group: "deal",
    hint: "Agreed, but we still need shipping details before anything moves.",
    terminal: false,
  },
  {
    value: "fulfilling",
    label: "Fulfilling",
    group: "fulfilment",
    hint: "Address in hand. Ready / shipped / delivered is tracked on the shipment.",
    terminal: false,
  },
  {
    value: "content_pending",
    label: "Content pending",
    group: "fulfilment",
    hint: "Product delivered and brief sent. Waiting on the video.",
    terminal: false,
  },
  {
    value: "posted",
    label: "Posted",
    group: "fulfilment",
    hint: "At least one deliverable is live.",
    terminal: false,
  },
  {
    value: "completed",
    label: "Completed",
    group: "fulfilment",
    hint: "Obligations met. Keeps Posted from becoming a parking lot.",
    terminal: false,
  },
  {
    value: "passed",
    label: "Passed",
    group: "closed",
    hint: "We ended it.",
    terminal: true,
  },
  {
    value: "declined",
    label: "Declined",
    group: "closed",
    hint: "They ended it.",
    terminal: true,
  },
  {
    value: "no_response",
    label: "No response",
    group: "closed",
    hint: "Went dark after follow-ups were exhausted.",
    terminal: true,
  },
];

export const STAGE_BY_VALUE = new Map(STAGES.map((s) => [s.value, s]));

export const ACTIVE_STAGES = STAGES.filter((s) => !s.terminal);
export const TERMINAL_STAGES = STAGES.filter((s) => s.terminal);

export function stageLabel(stage: CmStage): string {
  return STAGE_BY_VALUE.get(stage)?.label ?? stage;
}

export function stageHint(stage: CmStage): string {
  return STAGE_BY_VALUE.get(stage)?.hint ?? "";
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
    { value: "research_fit", label: "Research-stage fit / cadence cut" },
    { value: "below_cadence", label: "Below posting cadence" },
    { value: "wrong_pillar", label: "Wrong content pillar" },
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
    { value: "went_dark", label: "Went dark" },
    { value: "other", label: "Other" },
  ],
};

/** Tailwind classes per group, used by the board and the grid's stage pill. */
export const STAGE_GROUP_STYLES: Record<StageGroup, string> = {
  research: "bg-slate-100 text-slate-700 ring-slate-200",
  outreach: "bg-sky-100 text-sky-800 ring-sky-200",
  deal: "bg-amber-100 text-amber-900 ring-amber-200",
  fulfilment: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  closed: "bg-zinc-100 text-zinc-500 ring-zinc-200",
};

export function stageStyle(stage: CmStage): string {
  const group = STAGE_BY_VALUE.get(stage)?.group ?? "research";
  return STAGE_GROUP_STYLES[group];
}
