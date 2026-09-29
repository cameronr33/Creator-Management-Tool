import { cache } from "react";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmPartnerships, users } from "@/lib/db/schema";

/**
 * Who looks after each deal (owner decisions, 2026-09-28): new deals start
 * unassigned until someone takes them; "Mine" shows mine plus unassigned, so
 * nothing falls through; the choice is remembered, Everyone by default; the
 * assign list is everyone with a Sentic login (the shared users table — read
 * only here, never altered: frozen node 4).
 */

export type View = "mine" | "all";

export function parseView(raw: string | null | undefined): View {
  return raw === "mine" ? "mine" : "all";
}

/** Pure: does a deal with this owner show on this view? Mine = mine + unassigned. */
export function inView(ownerId: string | null, view: View, userId: string | null | undefined): boolean {
  if (view === "all" || !userId) return true;
  return ownerId === null || ownerId === userId;
}

export interface Teammate {
  id: string;
  name: string;
}

function words(name: string): string[] {
  return name.trim().split(/[\s&/]+/).filter(Boolean);
}

/**
 * Pure: a short label per teammate for the owner chip — initials ("KK"), and
 * where two people would share them, the first two letters of the first name
 * ("KiK" / "KaK") so a glance still tells them apart.
 */
export function chipLabels(team: Teammate[]): Map<string, string> {
  const base = new Map<string, string>();
  for (const t of team) {
    const w = words(t.name);
    const first = w[0] ?? "?";
    const label = w.length > 1 ? `${first[0]}${w[w.length - 1][0]}` : first.slice(0, 2);
    base.set(t.id, label.toUpperCase());
  }
  const counts = new Map<string, number>();
  for (const l of base.values()) counts.set(l, (counts.get(l) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const t of team) {
    const label = base.get(t.id)!;
    if ((counts.get(label) ?? 0) < 2) {
      out.set(t.id, label);
      continue;
    }
    const w = words(t.name);
    const first = w[0] ?? "?";
    const two = first.slice(0, 2);
    out.set(t.id, `${two[0].toUpperCase()}${two.slice(1).toLowerCase()}${w.length > 1 ? w[w.length - 1][0].toUpperCase() : ""}`);
  }
  return out;
}

/** Pure: split rows by the view, keeping who the hidden ones belong to. */
export function splitByView<T extends { ownerId: string | null; ownerName: string | null }>(rows: T[], view: View, userId: string | null | undefined): { shown: T[]; hidden: T[] } {
  const shown: T[] = [];
  const hidden: T[] = [];
  for (const r of rows) (inView(r.ownerId, view, userId) ? shown : hidden).push(r);
  return { shown, hidden };
}

/**
 * Pure: "7 of Kieran's not shown" — so nothing disappears without being
 * mentioned. With a search, the hidden ones that match: "2 of Kieran's also
 * match".
 */
export function hiddenSummary(hidden: { ownerName: string | null }[], opts: { matching?: boolean } = {}): string | null {
  if (!hidden.length) return null;
  const names = [...new Set(hidden.map((h) => (h.ownerName ?? "").split(" ")[0]).filter(Boolean))];
  const whose = names.length === 1 ? `${names[0]}'s` : names.length === 2 ? `${names[0]}'s and ${names[1]}'s` : "teammates'";
  return `${hidden.length} of ${whose} ${opts.matching ? "also match" : "not shown"}`;
}

/**
 * Pure: a list on a view, with an optional search. The search looks through
 * the hidden rows too, so a teammate's match is mentioned instead of "no
 * creators match". `total` is how many the view shows before searching;
 * `hidden` the hidden ones that match (all of them without a search);
 * `hiddenAll` every hidden one.
 */
export function splitForList<T extends { ownerId: string | null; ownerName: string | null }>(
  rows: T[],
  view: View,
  userId: string | null | undefined,
  matches: ((r: T) => boolean) | null,
): { rows: T[]; total: number; hidden: T[]; hiddenAll: T[] } {
  const { shown, hidden } = splitByView(rows, view, userId);
  return matches
    ? { rows: shown.filter(matches), total: shown.length, hidden: hidden.filter(matches), hiddenAll: hidden }
    : { rows: shown, total: shown.length, hidden, hiddenAll: hidden };
}

type Owned = { ownerName: string | null };

/** Pure: the list's "(…)" line on Mine — teammates' matches when searching, else how many of theirs aren't shown. */
export function listViewLine(o: { searching: boolean; hiddenAll: Owned[]; hiddenMatching: Owned[] }): string | null {
  return o.searching && o.hiddenMatching.length ? hiddenSummary(o.hiddenMatching, { matching: true }) : hiddenSummary(o.hiddenAll);
}

/**
 * Pure: why nothing is listed (second review, 2026-09-28 — a search with no
 * match on Mine said "No creators yet"): only teammates' match, nothing
 * matches, nothing of yours at all, or truly none yet.
 */
export function emptyListMessage(o: { searching: boolean; total: number; hiddenAll: Owned[]; hiddenMatching: Owned[] }): {
  kind: "teammates_match" | "no_match" | "only_teammates" | "empty";
  hint: string;
} {
  if (o.searching && o.hiddenMatching.length) return { kind: "teammates_match", hint: `${hiddenSummary(o.hiddenMatching, { matching: true })} — switch to Everyone to see them.` };
  if (o.searching || o.total > 0) return { kind: "no_match", hint: "Try clearing the search or the stage filter." };
  if (o.hiddenAll.length) return { kind: "only_teammates", hint: `${hiddenSummary(o.hiddenAll)} — switch to Everyone to see them.` };
  return { kind: "empty", hint: "Import a CSV with their names and a Campaign column, or add one by pasting their profile link." };
}

/** Everyone with a Sentic login — id and name only (never the email or password hash). */
export const listTeammates = cache(async (): Promise<Teammate[]> => {
  return db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name));
});

export type OwnerResult = { ok: true; updated: number } | { ok: false; error: string };

/**
 * Assign (or clear, with null) the owner of these deals. The id must be a
 * real login — checked here so a stale list gives a clear message, not a
 * database error. Never bumps updatedAt.
 */
export async function setOwner(ids: string[], ownerId: string | null): Promise<OwnerResult> {
  if (!ids.length) return { ok: true, updated: 0 };
  if (ownerId) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, ownerId)).limit(1);
    if (!u) return { ok: false, error: "That teammate isn't in the login list any more — reload the page" };
  }
  const done = await db.update(cmPartnerships).set({ ownerId }).where(inArray(cmPartnerships.id, ids)).returning({ id: cmPartnerships.id });
  return { ok: true, updated: done.length };
}

/** Take unassigned deals — never one someone else already owns. */
export async function takeUnassigned(ids: string[], userId: string): Promise<{ taken: number; alreadyOwned: number }> {
  if (!ids.length) return { taken: 0, alreadyOwned: 0 };
  const done = await db
    .update(cmPartnerships)
    .set({ ownerId: userId })
    .where(and(inArray(cmPartnerships.id, ids), isNull(cmPartnerships.ownerId)))
    .returning({ id: cmPartnerships.id });
  return { taken: done.length, alreadyOwned: ids.length - done.length };
}
