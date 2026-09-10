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
  const sorted = [...events].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

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

/**
 * Render a message template. Placeholders are {{name}}-style; any token with
 * no supplied value is left visible as [name] so a half-filled message is
 * obvious before it gets pasted into a DM.
 */
export function renderTemplate(
  body: string,
  vars: Record<string, string | null | undefined>,
): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value != null && value !== "" ? value : `[${key}]`;
  });
}

/**
 * Instagram DM deep link — Meta's official ig.me short link, which opens the
 * DM composer for a logged-in browser. The @username profile link stays the
 * fallback when IG shows a "message request" interstitial instead.
 */
export function igDmUrl(username: string): string {
  return `https://ig.me/m/${encodeURIComponent(username)}`;
}

export function igProfileUrl(username: string): string {
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}

/**
 * mailto: link with the subject and body pre-filled. `cc` is the connected
 * sync mailbox — the email loop can only see threads that mailbox is on, so
 * the cc is pre-filled rather than left to memory.
 */
export function mailtoUrl(email: string, subject: string | null, body: string, cc?: string | null): string {
  const params = new URLSearchParams();
  if (cc) params.set("cc", cc);
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  const qs = params.toString().replace(/\+/g, "%20");
  return `mailto:${email}${qs ? `?${qs}` : ""}`;
}

/** First name only — "Abel & Victoria" -> "Abel", "AUTUMN SCHWALBE" -> "Autumn". */
export function firstName(fullName: string): string {
  const first = fullName.trim().split(/[\s&/,]+/)[0] ?? fullName;
  if (!first) return fullName;
  // Sheet has SHOUTED names; normalise those but leave deliberate casing alone.
  if (first === first.toUpperCase() && first.length > 1) {
    return first[0] + first.slice(1).toLowerCase();
  }
  return first;
}
