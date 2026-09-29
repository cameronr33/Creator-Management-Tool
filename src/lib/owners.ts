import { cache } from "react";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmClientUsers, cmPartnerships, cmTeamMembers, users } from "@/lib/db/schema";

/**
 * Who looks after each deal (owner decisions, 2026-09-28 and 2026-09-29):
 * new deals start unassigned until someone takes them; "Mine" shows mine plus
 * unassigned, so nothing falls through; the choice is remembered, Everyone by
 * default. Owners come from the team list (cm_team_members), managed under
 * Settings → Team: a teammate needs no login to be assigned, and a login
 * whose email matches is linked to them. The shared users table is only
 * read here, never altered (frozen node 4).
 */

/**
 * A team member's id — never a login's. Branded so the compiler catches the
 * two getting mixed up ("Mine" would quietly show only unassigned deals).
 */
export type MemberId = string & { readonly __teamMember: true };

export type View = "mine" | "all";

export function parseView(raw: string | null | undefined): View {
  return raw === "mine" ? "mine" : "all";
}

/** Pure: does a deal with this owner show on this view? Mine = mine + unassigned. */
export function inView(ownerId: string | null, view: View, me: MemberId | null | undefined): boolean {
  if (view === "all" || !me) return true;
  return ownerId === null || ownerId === me;
}

export interface Teammate {
  id: string;
  name: string;
  /** Off: kept for history and chips, not offered to assign. */
  active: boolean;
}

function words(name: string): string[] {
  return name.trim().split(/[\s&/]+/).filter(Boolean);
}

/**
 * Pure: a short label per teammate for the owner chip — initials ("KK"), and
 * where two people would share them, the first two letters of the first name
 * ("KiK" / "KaK") so a glance still tells them apart.
 */
export function chipLabels(team: Pick<Teammate, "id" | "name">[]): Map<string, string> {
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
export function splitByView<T extends { ownerId: string | null; ownerName: string | null }>(rows: T[], view: View, me: MemberId | null | undefined): { shown: T[]; hidden: T[] } {
  const shown: T[] = [];
  const hidden: T[] = [];
  for (const r of rows) (inView(r.ownerId, view, me) ? shown : hidden).push(r);
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
  me: MemberId | null | undefined,
  matches: ((r: T) => boolean) | null,
): { rows: T[]; total: number; hidden: T[]; hiddenAll: T[] } {
  const { shown, hidden } = splitByView(rows, view, me);
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

/* ── The team ───────────────────────────────────────────────────── */

/** Everyone on the team, active or not (chips need a label for a past owner) — id and name only. */
export const listTeammates = cache(async (): Promise<Teammate[]> => {
  return db.select({ id: cmTeamMembers.id, name: cmTeamMembers.name, active: cmTeamMembers.active }).from(cmTeamMembers).orderBy(asc(cmTeamMembers.name));
});

/** The team for Settings → Team: who, their email, and whether they've signed in. */
export async function listTeamForSettings(): Promise<{ id: string; name: string; email: string | null; active: boolean; hasLogin: boolean }[]> {
  const rows = await db
    .select({ id: cmTeamMembers.id, name: cmTeamMembers.name, email: cmTeamMembers.email, active: cmTeamMembers.active, userId: cmTeamMembers.userId })
    .from(cmTeamMembers)
    .orderBy(asc(cmTeamMembers.name));
  return rows.map(({ userId, ...r }) => ({ ...r, hasLogin: !!userId }));
}

/** Login names by login id — for "· by Kieran" on what someone logged (read-only; never the email or hash). */
export const listLoginNames = cache(async (): Promise<Map<string, string>> => {
  const rows = await db.select({ id: users.id, name: users.name }).from(users);
  return new Map(rows.map((r) => [r.id, r.name]));
});

export interface Me {
  id: MemberId;
  name: string;
}

/**
 * The team member for this login: linked by login id, else the teammate
 * added by hand with the same email (linked now), else a new one — every
 * login that opens the app is on the team. Never for a brand's portal login.
 * Safe when two pages load at once (the insert yields to the unique index).
 * Also hands over a deal assigned before the team list existed.
 */
export async function memberForUser(user: { id: string; name?: string | null; email?: string | null; kind?: string | null }): Promise<Me | null> {
  if (user.kind === "client" || !user.id) return null;
  const email = user.email?.trim().toLowerCase() || null;
  const byLogin = () => db.select({ id: cmTeamMembers.id, name: cmTeamMembers.name }).from(cmTeamMembers).where(eq(cmTeamMembers.userId, user.id)).limit(1);
  let [m] = await byLogin();
  if (!m && email) {
    [m] = await db
      .update(cmTeamMembers)
      .set({ userId: user.id })
      .where(and(eq(cmTeamMembers.email, email), isNull(cmTeamMembers.userId)))
      .returning({ id: cmTeamMembers.id, name: cmTeamMembers.name });
  }
  if (!m) {
    await db
      .insert(cmTeamMembers)
      .values({ name: user.name?.trim() || email || "Teammate", email, userId: user.id })
      .onConflictDoNothing();
    [m] = await byLogin();
  }
  if (!m) return null;
  await db
    .update(cmPartnerships)
    .set({ ownerId: m.id, legacyOwnerUserId: null })
    .where(and(eq(cmPartnerships.legacyOwnerUserId, user.id), isNull(cmPartnerships.ownerId)));
  return { id: m.id as MemberId, name: m.name };
}

export type TeamResult = { ok: true; id: string } | { ok: false; error: string };

async function emailProblem(email: string | null, exceptId?: string): Promise<string | null> {
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "That doesn't look like an email address";
  const [brand] = await db.select({ id: cmClientUsers.id }).from(cmClientUsers).where(eq(cmClientUsers.email, email)).limit(1);
  if (brand) return "That email is a brand's portal login — teammates are people at Sentic";
  const [taken] = await db.select({ id: cmTeamMembers.id }).from(cmTeamMembers).where(eq(cmTeamMembers.email, email)).limit(1);
  if (taken && taken.id !== exceptId) return "Someone on the team already has that email";
  return null;
}

/** Settings → Team: add a teammate. No login needed to be assigned deals. */
export async function addTeammate(input: { name: string; email?: string | null }): Promise<TeamResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Add their name" };
  const email = input.email?.trim().toLowerCase() || null;
  const problem = await emailProblem(email);
  if (problem) return { ok: false, error: problem };
  const [row] = await db.insert(cmTeamMembers).values({ name, email }).onConflictDoNothing().returning({ id: cmTeamMembers.id });
  return row ? { ok: true, id: row.id } : { ok: false, error: "Someone on the team already has that email" };
}

/** Settings → Team: rename, change the email, or switch someone off (their deals keep them as owner). */
export async function updateTeammate(id: string, input: { name?: string; email?: string | null; active?: boolean }): Promise<TeamResult> {
  const set: Partial<{ name: string; email: string | null; active: boolean }> = {};
  if (input.name !== undefined) {
    if (!input.name.trim()) return { ok: false, error: "Add their name" };
    set.name = input.name.trim();
  }
  if (input.email !== undefined) {
    const email = input.email?.trim().toLowerCase() || null;
    const problem = await emailProblem(email, id);
    if (problem) return { ok: false, error: problem };
    set.email = email;
  }
  if (input.active !== undefined) set.active = input.active;
  if (!Object.keys(set).length) return { ok: true, id };
  const done = await db.update(cmTeamMembers).set(set).where(eq(cmTeamMembers.id, id)).returning({ id: cmTeamMembers.id });
  return done.length ? { ok: true, id } : { ok: false, error: "That teammate isn't on the list any more — reload the page" };
}

/* ── Assigning ──────────────────────────────────────────────────── */

/** Who owned each deal before a change — what the toast's Undo puts back. */
export type PriorOwner = { id: string; ownerId: string | null };

export type OwnerResult = { ok: true; updated: number; prior: PriorOwner[] } | { ok: false; error: string };

/**
 * Assign (or clear, with null) the owner of these deals. The teammate must
 * be on the team and switched on — checked here so a stale list gives a clear
 * message, not a database error. Never bumps updatedAt.
 */
export async function setOwner(ids: string[], ownerId: string | null): Promise<OwnerResult> {
  if (!ids.length) return { ok: true, updated: 0, prior: [] };
  if (ownerId) {
    const [m] = await db.select({ active: cmTeamMembers.active }).from(cmTeamMembers).where(eq(cmTeamMembers.id, ownerId)).limit(1);
    if (!m) return { ok: false, error: "That teammate isn't on the team list any more — reload the page" };
    if (!m.active) return { ok: false, error: "That teammate is switched off in Settings → Team" };
  }
  const prior = await db.select({ id: cmPartnerships.id, ownerId: cmPartnerships.ownerId }).from(cmPartnerships).where(inArray(cmPartnerships.id, ids));
  const done = await db
    .update(cmPartnerships)
    .set({ ownerId, legacyOwnerUserId: null })
    .where(inArray(cmPartnerships.id, ids))
    .returning({ id: cmPartnerships.id });
  return { ok: true, updated: done.length, prior };
}

/** Take unassigned deals — never one someone else already owns. */
export async function takeUnassigned(ids: string[], me: MemberId): Promise<{ taken: number; alreadyOwned: number; prior: PriorOwner[] }> {
  if (!ids.length) return { taken: 0, alreadyOwned: 0, prior: [] };
  const done = await db
    .update(cmPartnerships)
    .set({ ownerId: me, legacyOwnerUserId: null })
    .where(and(inArray(cmPartnerships.id, ids), isNull(cmPartnerships.ownerId)))
    .returning({ id: cmPartnerships.id });
  return { taken: done.length, alreadyOwned: ids.length - done.length, prior: done.map((d) => ({ id: d.id, ownerId: null })) };
}

/**
 * Undo an owner change: put each deal back to who owned it before — only
 * where the owner is still the one we set, so a change someone made since
 * stands. One statement.
 */
export async function restoreOwners(prior: PriorOwner[], expected: string | null): Promise<{ restored: number }> {
  if (!prior.length) return { restored: 0 };
  const values = sql.join(
    prior.map((p) => sql`(${p.id}::uuid, ${p.ownerId}::uuid)`),
    sql`, `,
  );
  const res = await db.execute(sql`
    update ${cmPartnerships} p set owner_member_id = v.owner
    from (values ${values}) as v(id, owner)
    where p.id = v.id and p.owner_member_id is not distinct from ${expected}::uuid
    returning p.id
  `);
  return { restored: (res.rows as unknown[]).length };
}
