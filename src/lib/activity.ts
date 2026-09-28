/**
 * "What happened last, and whose move is it?" — the line shown on every
 * Pipeline card and Today row. Pure, so the same answer comes out wherever
 * it's shown (scripts/verify-activity.ts).
 *
 * When the email reader's summary is about the latest message, it wins: it
 * says what the message *says*. Otherwise (a DM logged since, or never read)
 * the last message itself answers — who wrote, how, and when. Invites and
 * automatic replies are notes and never count as the last message.
 */

export type WhoseTurn = "us" | "them" | "none";

export interface LastMessage {
  at: Date;
  direction: "inbound" | "outbound";
  channel: string;
  senderRole: string | null;
  subject: string | null;
  isMigrated: boolean;
}

export interface ActivityInput {
  last: LastMessage | null;
  emailSummary: string | null;
  /** The message the summary describes (its time). */
  emailSummaryAt: Date | null;
  emailWhoseTurn: string | null;
  /** "No reply needed" was clicked at this time. */
  replyHandledAt: Date | null;
}

export interface Activity {
  /** One plain line: the summary, or who wrote last and how. */
  text: string;
  /** When the last message was sent; null when unknown (imported rows) or none. */
  at: Date | null;
  whoseTurn: WhoseTurn | null;
  /** True when the text is the summary of their email. */
  fromEmail: boolean;
  /** Who sent the last real message — we ("us") or they ("them"); null when there's none. */
  lastFrom: "us" | "them" | null;
}

function cleanSubject(s: string | null): string | null {
  const t = (s ?? "").replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim();
  return t ? (t.length > 70 ? `${t.slice(0, 69)}…` : t) : null;
}

function describe(m: LastMessage): string {
  const subject = cleanSubject(m.subject);
  const about = subject ? `: “${subject}”` : "";
  if (m.direction === "inbound") {
    if (m.senderRole === "other") return `Someone on their thread emailed${about}`;
    if (m.channel === "email") return `They emailed${about}`;
    if (m.channel === "ig_dm") return "They replied by DM";
    if (m.channel === "phone") return "They called";
    return "They replied";
  }
  if (m.channel === "email") return `We emailed${about}`;
  if (m.channel === "ig_dm") return "We sent a DM";
  if (m.channel === "phone") return "We spoke on the phone";
  return "We messaged them";
}

export function latestActivity(i: ActivityInput): Activity {
  const { last } = i;
  if (!last) {
    return i.emailSummary
      ? { text: i.emailSummary, at: i.emailSummaryAt, whoseTurn: turn(i.emailWhoseTurn), fromEmail: true, lastFrom: null }
      : { text: "No messages yet", at: null, whoseTurn: null, fromEmail: false, lastFrom: null };
  }
  // The summary is current when it describes this very message (or a later one).
  const summaryCurrent = !!i.emailSummary && !!i.emailSummaryAt && i.emailSummaryAt.getTime() >= last.at.getTime();
  let whoseTurn: WhoseTurn | null = summaryCurrent ? turn(i.emailWhoseTurn) : last.direction === "inbound" ? "us" : "them";
  if (whoseTurn === "us" && i.replyHandledAt && i.replyHandledAt.getTime() >= last.at.getTime()) whoseTurn = "none";
  const lastFrom = last.direction === "outbound" ? "us" : "them";
  if (last.isMigrated) {
    return { text: `${describe(last)} (imported from the sheet — date unknown)`, at: null, whoseTurn, fromEmail: false, lastFrom };
  }
  return summaryCurrent
    ? { text: i.emailSummary!, at: last.at, whoseTurn, fromEmail: true, lastFrom }
    : { text: describe(last), at: last.at, whoseTurn, fromEmail: false, lastFrom };
}

function turn(t: string | null): WhoseTurn | null {
  return t === "us" || t === "them" || t === "none" ? t : null;
}

/** Whose turn, as people say it. */
export function whoseTurnText(t: WhoseTurn | null): { label: string; tone: "warn" | "muted" | "info" } | null {
  if (t === "us") return { label: "Your turn", tone: "warn" };
  if (t === "them") return { label: "Waiting on them", tone: "muted" };
  if (t === "none") return { label: "Nothing pending", tone: "info" };
  return null;
}
