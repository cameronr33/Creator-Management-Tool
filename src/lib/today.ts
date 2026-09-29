import type { CmStage } from "@/lib/db/schema";
import type { WhoseTurn } from "@/lib/activity";
import type { FollowUpThresholds } from "@/lib/outreach";
import { canonicalStage, isTerminal, stageAction } from "@/lib/stages";

/**
 * Today: every live creator in exactly one section, each with one thing to
 * do. Pure (scripts/verify-today.ts). The order is the order of the work —
 * answer people first, then chase, then reach out, then move product — and
 * within a section, whoever has waited longest comes first.
 *
 * Fulfilment stages keep their own section even when it's our turn (a
 * creator in Ready to ship who just emailed is still "ship it"); the row
 * shows "Your turn" so the email isn't missed. A deal gone quiet at Talking,
 * Agreed or Finalizing comes back to Follow up after the nudge days (owner,
 * 2026-09-28: "nudges for stalled deals"). Posted and closed deals aren't on
 * Today.
 */

export type TodaySection =
  | "your_turn"
  | "follow_up"
  | "to_contact"
  | "waiting_approval"
  | "get_address"
  | "finalizing"
  | "ready_to_ship"
  | "shipped"
  | "waiting_video"
  | "waiting";

export const TODAY_SECTIONS: { key: TodaySection; title: string; hint: string }[] = [
  { key: "your_turn", title: "Your turn", hint: "They wrote last. Reply, or mark it as needing no reply." },
  {
    key: "follow_up",
    title: "Follow up",
    hint: "We wrote and they haven't answered in a while — including deals gone quiet at Talking, Agreed or Finalizing. Nudge them. Email on threads that include the mailbox is picked up by itself; log anything else here.",
  },
  { key: "to_contact", title: "To contact", hint: stageAction("shortlisted") },
  { key: "waiting_approval", title: "Waiting on client approval", hint: "The client decides on these before anyone reaches out. Approve or pass for them if they've told you." },
  { key: "get_address", title: "Agreed — get the address", hint: stageAction("awaiting_address") },
  { key: "finalizing", title: "Finalizing — contract and questions", hint: stageAction("finalizing") },
  { key: "ready_to_ship", title: "Ready to ship", hint: stageAction("fulfilling") },
  { key: "shipped", title: "Shipped — on the way", hint: stageAction("shipped") },
  { key: "waiting_video", title: "Waiting on video", hint: stageAction("content_pending") },
  { key: "waiting", title: "Waiting on them", hint: "Nothing to do yet. They move up here when they write back or a follow-up is due." },
];

export interface TodayFacts {
  stage: CmStage;
  whoseTurn: WhoseTurn | null;
  lastOutboundAt: Date | null;
  followUpCount: number;
  datesAreMigrated: boolean;
  thresholds: FollowUpThresholds;
  /** The client's say before outreach, when they give one. */
  clientApproval?: "pending" | "approved" | "passed" | null;
  now?: Date;
  // "Waiting since" (2026-09-28). All optional: unknown dates get no clock.
  /** Who sent the last real message. */
  lastFrom?: "us" | "them" | null;
  /** When the last real message was sent (null for imported rows — date unknown). */
  lastMessageAt?: Date | null;
  /** When the deal entered its current stage. */
  stageSince?: Date | null;
  /** When the client approved it for outreach. */
  approvalAt?: Date | null;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
}

export interface TodayPlacement {
  section: TodaySection;
  /** A short extra line when the section alone doesn't say it. */
  note: string | null;
  /** Waiting since — rows sort oldest first within a section; null = unknown (sorts last). */
  since: Date | null;
  /** "due": the first message is due; "late": the video is overdue. */
  badge: "due" | "late" | null;
}

const DAY = 86_400_000;

function days(since: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY));
}

function ago(n: number): string {
  return n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
}

function dayCount(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

/** Posted and closed deals never show on Today; everything else has a section. */
export function listedOnToday(stage: CmStage): boolean {
  const s = canonicalStage(stage);
  return !isTerminal(s) && s !== "posted";
}

/**
 * The nudge line for a deal gone quiet, by the stage it's stuck at. "Quiet",
 * not "no reply": the last message may be their promise that went unkept.
 */
export const NUDGE_LINES: Partial<Record<CmStage, (n: number) => string>> = {
  in_conversation: (n) => `Quiet for ${dayCount(n)} — nudge them.`,
  awaiting_address: (n) => `Quiet for ${dayCount(n)} — nudge them for their address.`,
  finalizing: (n) => `Quiet for ${dayCount(n)} — nudge them about what's still open.`,
};

function place(section: TodaySection, note: string | null, since: Date | null | undefined, badge: TodayPlacement["badge"] = null): TodayPlacement {
  return { section, note, since: since ?? null, badge };
}

/**
 * A quiet deal: we're waiting on them (they owe the next message — whether
 * we wrote last, or they promised something and went silent) and nothing has
 * happened for the nudge days: no message, and no stage move either — a deal
 * moved to Agreed this morning isn't quiet, however old the last DM.
 * Imported rows (no date) never get a clock.
 */
function nudge(f: TodayFacts, stage: CmStage, now: Date): TodayPlacement | null {
  const line = NUDGE_LINES[stage];
  if (!line || !f.lastMessageAt) return null;
  const waitingOnThem = f.whoseTurn === "them" || (f.whoseTurn == null && f.lastFrom === "us");
  if (!waitingOnThem) return null;
  const quietSince = f.stageSince && f.stageSince.getTime() > f.lastMessageAt.getTime() ? f.stageSince : f.lastMessageAt;
  const n = days(quietSince, now);
  return n >= f.thresholds.nudgeAfterDays ? place("follow_up", line(n), quietSince) : null;
}

export function placeOnToday(f: TodayFacts): TodayPlacement | null {
  const stage = canonicalStage(f.stage);
  const now = f.now ?? new Date();
  if (!listedOnToday(stage)) return null;
  switch (stage) {
    case "fulfilling":
      return place("ready_to_ship", null, f.stageSince);
    case "shipped": {
      if (f.shippedAt) return place("shipped", `Shipped ${ago(days(f.shippedAt, now))}.`, f.shippedAt);
      return place("shipped", f.stageSince ? `In Shipped for ${dayCount(days(f.stageSince, now))} — no ship date recorded.` : null, f.stageSince);
    }
    case "content_pending": {
      const since = f.deliveredAt ?? f.stageSince ?? null;
      if (!since) return place("waiting_video", null, null);
      const n = days(since, now);
      const late = n >= f.thresholds.videoDueAfterDays;
      const what = f.deliveredAt ? `Delivered ${ago(n)}` : `Waiting on the video for ${dayCount(n)} — no delivery date recorded`;
      return place("waiting_video", late ? `${what} — the video is late (due after ${f.thresholds.videoDueAfterDays} days).` : `${what}.`, since, late ? "late" : null);
    }
    case "awaiting_address":
      return nudge(f, stage, now) ?? place("get_address", null, f.stageSince);
    case "finalizing":
      return nudge(f, stage, now) ?? place("finalizing", f.whoseTurn === "us" ? "They wrote last — reply." : null, f.stageSince);
  }
  if (f.whoseTurn === "us") return place("your_turn", null, f.lastMessageAt);
  if (stage === "shortlisted") {
    if (f.clientApproval === "pending") return place("waiting_approval", null, f.stageSince);
    // The clock starts when they could first be contacted: added, or approved by the client.
    const since = [f.stageSince, f.approvalAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    if (since && days(since, now) >= f.thresholds.initialOutreachAfterDays) {
      return place("to_contact", `Ready to contact for ${dayCount(days(since, now))} — the first message is due.`, since, "due");
    }
    return place("to_contact", null, since);
  }
  if (stage === "contacted") {
    if (f.datesAreMigrated) return place("waiting", "Imported from the sheet — when we last wrote is unknown.", null);
    if (!f.lastOutboundAt) return place("waiting", null, f.lastMessageAt);
    const n = days(f.lastOutboundAt, now);
    if (f.followUpCount >= 2) {
      return n >= f.thresholds.markNoResponseAfterDays
        ? place("follow_up", `No reply after ${f.followUpCount} follow-ups — close as No response if they stay quiet.`, f.lastOutboundAt)
        : place("waiting", null, f.lastOutboundAt);
    }
    const after = f.followUpCount === 0 ? f.thresholds.followUp1AfterDays : f.thresholds.followUp2AfterDays;
    return n >= after
      ? // The row's latest-message line already says when we last wrote (run-through, 2026-09-29).
        place("follow_up", `Follow-up ${f.followUpCount + 1} is due.`, f.lastOutboundAt)
      : place("waiting", null, f.lastOutboundAt);
  }
  return nudge(f, stage, now) ?? place("waiting", null, f.lastMessageAt);
}

/**
 * Pure: whoever has waited longest first, within each section (sections keep
 * their fixed order when the list groups them). Unknown dates go last; ties
 * by name.
 */
export function sortToday<T extends { since: string | Date | null; name: string }>(rows: T[]): T[] {
  const t = (d: string | Date | null) => (d == null ? Number.POSITIVE_INFINITY : new Date(d).getTime());
  return [...rows].sort((a, b) => t(a.since) - t(b.since) || a.name.localeCompare(b.name));
}
