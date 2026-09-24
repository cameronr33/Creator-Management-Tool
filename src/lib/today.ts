import type { CmStage } from "@/lib/db/schema";
import type { WhoseTurn } from "@/lib/activity";
import type { FollowUpThresholds } from "@/lib/outreach";
import { canonicalStage, isTerminal, stageAction } from "@/lib/stages";

/**
 * Today: every live creator in exactly one section, each with one thing to
 * do. Pure (scripts/verify-today.ts). The order is the order of the work —
 * answer people first, then chase, then reach out, then move product.
 *
 * Fulfilment stages keep their own section even when it's our turn (a
 * creator in Ready to ship who just emailed is still "ship it"); the row
 * shows "Your turn" so the email isn't missed. Posted and closed deals
 * aren't on Today.
 */

export type TodaySection =
  | "your_turn"
  | "follow_up"
  | "to_contact"
  | "waiting_approval"
  | "get_address"
  | "ready_to_ship"
  | "shipped"
  | "waiting_video"
  | "waiting";

export const TODAY_SECTIONS: { key: TodaySection; title: string; hint: string }[] = [
  { key: "your_turn", title: "Your turn", hint: "They wrote last. Reply, or mark it as needing no reply." },
  { key: "follow_up", title: "Follow up", hint: "We wrote and they haven't answered in a while. Nudge them, then click I messaged them for a DM (emails are tracked by themselves)." },
  { key: "to_contact", title: "To contact", hint: stageAction("shortlisted") },
  { key: "waiting_approval", title: "Waiting on client approval", hint: "The client decides on these before anyone reaches out. Approve or pass for them if they've told you." },
  { key: "get_address", title: "Agreed — get the address", hint: stageAction("awaiting_address") },
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
}

export interface TodayPlacement {
  section: TodaySection;
  /** A short extra line when the section alone doesn't say it. */
  note: string | null;
}

const DAY = 86_400_000;

export function placeOnToday(f: TodayFacts): TodayPlacement | null {
  const stage = canonicalStage(f.stage);
  if (isTerminal(stage) || stage === "posted") return null;
  switch (stage) {
    case "fulfilling":
      return { section: "ready_to_ship", note: null };
    case "shipped":
      return { section: "shipped", note: null };
    case "content_pending":
      return { section: "waiting_video", note: null };
    case "awaiting_address":
      return { section: "get_address", note: null };
  }
  if (f.whoseTurn === "us") return { section: "your_turn", note: null };
  if (stage === "shortlisted") return f.clientApproval === "pending" ? { section: "waiting_approval", note: null } : { section: "to_contact", note: null };
  if (stage === "contacted") {
    if (f.datesAreMigrated) return { section: "waiting", note: "Imported from the sheet — when we last wrote is unknown." };
    if (!f.lastOutboundAt) return { section: "waiting", note: null };
    const days = Math.floor(((f.now ?? new Date()).getTime() - f.lastOutboundAt.getTime()) / DAY);
    if (f.followUpCount >= 2) {
      return days >= f.thresholds.markNoResponseAfterDays
        ? { section: "follow_up", note: `No reply after ${f.followUpCount} follow-ups — close as No response if they stay quiet.` }
        : { section: "waiting", note: null };
    }
    const after = f.followUpCount === 0 ? f.thresholds.followUp1AfterDays : f.thresholds.followUp2AfterDays;
    return days >= after
      ? { section: "follow_up", note: `Last message ${days} days ago${f.followUpCount ? ` · ${f.followUpCount} follow-up sent` : ""}.` }
      : { section: "waiting", note: null };
  }
  return { section: "waiting", note: null };
}
