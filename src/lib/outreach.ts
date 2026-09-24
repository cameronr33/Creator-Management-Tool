import type { CmOutreachEvent } from "@/lib/db/schema";

/**
 * Everything the old spreadsheet stored as booleans (Messaged, Follow up 1,
 * Follow up 2) is derived from the event timeline instead. One source of
 * truth, unlimited follow-ups, and real dates.
 */
export interface OutreachState {
  totalOutbound: number;
  followUpCount: number;
  firstContactAt: Date | null;
  lastOutboundAt: Date | null;
  lastContactAt: Date | null;
  repliedAt: Date | null;
  hasReplied: boolean;
  /** Days since our most recent outbound message, or null if never contacted. */
  daysSinceLastOutbound: number | null;
  /** True when every outbound row came from the sheet migration. */
  datesAreMigrated: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(from: Date, to: Date = new Date()): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

export function deriveOutreachState(
  events: Pick<
    CmOutreachEvent,
    "occurredAt" | "direction" | "kind" | "isMigrated"
  >[],
  now: Date = new Date(),
): OutreachState {
  // Notes aren't messages: a hand-written note, a calendar invite or an
  // out-of-office reply never counts as contact, a reply, or a follow-up.
  const sorted = events
    .filter((e) => e.kind !== "note")
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const outbound = sorted.filter((e) => e.direction === "outbound");
  const inbound = sorted.filter((e) => e.direction === "inbound");
  const followUps = outbound.filter((e) => e.kind === "follow_up");

  const lastOutboundAt = outbound.length
    ? outbound[outbound.length - 1].occurredAt
    : null;
  const lastContactAt = sorted.length
    ? sorted[sorted.length - 1].occurredAt
    : null;

  return {
    totalOutbound: outbound.length,
    followUpCount: followUps.length,
    firstContactAt: outbound.length ? outbound[0].occurredAt : null,
    lastOutboundAt,
    lastContactAt,
    repliedAt: inbound.length ? inbound[0].occurredAt : null,
    hasReplied: inbound.length > 0,
    daysSinceLastOutbound: lastOutboundAt ? daysBetween(lastOutboundAt, now) : null,
    datesAreMigrated: outbound.length > 0 && outbound.every((e) => e.isMigrated),
  };
}

/** Thresholds for the follow-up loop. Configurable per client later. */
export interface FollowUpThresholds {
  initialOutreachAfterDays: number;
  followUp1AfterDays: number;
  followUp2AfterDays: number;
  markNoResponseAfterDays: number;
}

export const DEFAULT_THRESHOLDS: FollowUpThresholds = {
  initialOutreachAfterDays: 3,
  followUp1AfterDays: 5,
  followUp2AfterDays: 7,
  markNoResponseAfterDays: 10,
};

/** Channel enum values as a teammate reads them. */
export const CHANNEL_LABELS: Record<string, string> = {
  ig_dm: "Instagram DM",
  email: "Email",
  phone: "Phone",
  other: "Other",
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

