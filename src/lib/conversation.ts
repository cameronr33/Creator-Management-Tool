import { displayNames } from "@/lib/email-body";

/**
 * The creator page's conversation, grouped the way people remember it: one
 * group per email thread the mailbox holds (newest thread first), and one for
 * everything logged by hand — DMs, calls, notes and emails from a teammate's
 * own inbox. Pure (scripts/verify-logging.ts).
 */

export interface ThreadEvent {
  id: string;
  occurredAt: Date;
  channel: string;
  threadId: string | null;
  subject: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  messageId: string | null;
  /** Set on email the mailbox holds; null on anything logged by hand. Required so no caller can drop it and misfile every email. */
  externalId: string | null;
}

export interface Thread<E extends ThreadEvent> {
  key: string;
  title: string;
  isEmail: boolean;
  /** Everyone who wrote or was written to, by display name. */
  participants: string[];
  /** Oldest first. */
  events: E[];
  lastAt: Date;
  /** Opens the thread in Gmail (by its latest Message-ID), when known. */
  gmailUrl: string | null;
}

const OTHER = "__other__";

export function groupThreads<E extends ThreadEvent>(events: E[]): Thread<E>[] {
  const groups = new Map<string, E[]>();
  for (const e of events) {
    const synced = e.channel === "email" && !!e.externalId;
    const key = synced && e.threadId ? e.threadId : synced ? `email:${e.id}` : OTHER;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const threads: Thread<E>[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const isEmail = key !== OTHER;
    const first = sorted.find((e) => e.subject) ?? sorted[0];
    const names = new Set<string>();
    for (const e of sorted) for (const who of [e.fromAddress, e.toAddress]) for (const n of (displayNames(who) || "").split(/,\s*/)) if (n) names.add(n);
    const withId = [...sorted].reverse().find((e) => e.messageId);
    threads.push({
      key,
      title: isEmail ? (first.subject ?? "(no subject)").replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "") : "Logged by hand: DMs, calls, notes and emails from your own inbox",
      isEmail,
      participants: [...names],
      events: sorted,
      lastAt: sorted[sorted.length - 1].occurredAt,
      gmailUrl: withId?.messageId ? gmailSearchUrl(withId.messageId) : null,
    });
  }
  return threads.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}

/** Gmail's search for one message by its Message-ID header. */
export function gmailSearchUrl(messageId: string): string {
  const id = messageId.trim().replace(/^<|>$/g, "");
  return `https://mail.google.com/mail/u/0/#search/rfc822msgid%3A${encodeURIComponent(id)}`;
}
