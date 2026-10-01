/**
 * "We said we'd get back to them" (owner, 2026-09-30). HELLA's partner wrote
 * to Michael Dey "We will circle back with you once we have specific launch
 * dates" — and nobody did. The email reader now names an open promise from
 * our side (us or the brand), kept only with the line found word for word in
 * our message (email-status.ts verifiedPromise). Today lists it until a
 * person marks it done or a later message shows it was. Pure
 * (scripts/verify-today.ts).
 */

export interface PromiseFacts {
  /** What we said we'd do, in a few plain words ("Circle back with launch dates"). */
  promiseText: string | null;
  /** When the message with the promise was sent. */
  promiseAt: Date | null;
  /** "Mark done" pressed: closed until a newer promise. */
  promiseDoneAt: Date | null;
}

export interface OpenPromise {
  what: string;
  at: Date;
}

export function openPromise(f: PromiseFacts): OpenPromise | null {
  if (!f.promiseText || !f.promiseAt) return null;
  if (f.promiseDoneAt && f.promiseDoneAt.getTime() >= f.promiseAt.getTime()) return null;
  return { what: f.promiseText, at: f.promiseAt };
}

const DAY = 86_400_000;

/** "Promised 54 days ago: circle back with launch dates." — a leading name (HELLA) keeps its capital. */
export function promiseLine(p: OpenPromise, now = new Date()): string {
  const n = Math.max(0, Math.floor((now.getTime() - p.at.getTime()) / DAY));
  const when = n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
  const first = p.what.split(/\s/)[0] ?? "";
  const what = first.length > 1 && first === first.toUpperCase() ? p.what : p.what.charAt(0).toLowerCase() + p.what.slice(1);
  return `Promised ${when}: ${what}.`;
}
