import { cookies } from "next/headers";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmCampaigns, cmCreatorEmails, cmCreators, cmGmailAccounts, cmPartnerships } from "@/lib/db/schema";

/**
 * Campaigns: the scope every page works in, and the one place partnerships
 * are removed or moved between campaigns.
 *
 * Names match ignoring case and extra spaces everywhere (imports, the add
 * form, rename), backed by a unique index on (client, lower(name)).
 * Deleting is partnership-first: a row in a campaign-scoped view is a
 * creator × campaign, so "delete" removes them from that campaign, and a
 * creator left with no campaign at all is removed too (nothing invisible
 * is left behind — every creator has at least one partnership).
 */

export function normalizeCampaignName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export async function findCampaignByName(clientId: string, name: string): Promise<{ id: string; name: string } | null> {
  const n = normalizeCampaignName(name);
  if (!n) return null;
  const [row] = await db
    .select({ id: cmCampaigns.id, name: cmCampaigns.name })
    .from(cmCampaigns)
    .where(and(eq(cmCampaigns.clientId, clientId), sql`lower(${cmCampaigns.name}) = lower(${n})`))
    .limit(1);
  return row ?? null;
}

/** Find (ignoring case) or create. Safe when two imports create the same name at once. */
export async function ensureCampaign(clientId: string, name: string): Promise<{ id: string; name: string; created: boolean }> {
  const n = normalizeCampaignName(name);
  if (!n) throw new Error("A campaign needs a name");
  const found = await findCampaignByName(clientId, n);
  if (found) return { ...found, created: false };
  const [row] = await db.insert(cmCampaigns).values({ clientId, name: n }).onConflictDoNothing().returning({ id: cmCampaigns.id, name: cmCampaigns.name });
  if (row) return { ...row, created: true };
  const raced = await findCampaignByName(clientId, n);
  if (!raced) throw new Error("Couldn't create the campaign");
  return { ...raced, created: false };
}

export async function renameCampaign(clientId: string, id: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const n = normalizeCampaignName(name);
  if (!n) return { ok: false, error: "A campaign needs a name" };
  const clash = await db
    .select({ id: cmCampaigns.id })
    .from(cmCampaigns)
    .where(and(eq(cmCampaigns.clientId, clientId), ne(cmCampaigns.id, id), sql`lower(${cmCampaigns.name}) = lower(${n})`))
    .limit(1);
  if (clash.length) return { ok: false, error: "Another campaign already has that name" };
  const r = await db.update(cmCampaigns).set({ name: n }).where(and(eq(cmCampaigns.id, id), eq(cmCampaigns.clientId, clientId))).returning({ id: cmCampaigns.id });
  return r.length ? { ok: true } : { ok: false, error: "That campaign isn't here any more. Reload the page." };
}

export interface RemovalResult {
  /** Creator × campaign rows removed. */
  removed: number;
  /** Creators deleted because no campaign was left. */
  creatorsDeleted: number;
  /** Creators who stay because they're in another campaign. */
  creatorsKept: number;
}

/**
 * Remove partnerships (all cascades — conversation, shipping, videos — go
 * with them) and any creator left without a campaign. One statement, so a
 * half-done delete can't exist. Creators who stay in another campaign get
 * their addresses re-searched on the next email check, so their mail is
 * re-filed onto the partnership that remains.
 */
export async function removePartnerships(ids: string[]): Promise<RemovalResult> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { removed: 0, creatorsDeleted: 0, creatorsKept: 0 };
  const res = await db.execute(sql`
    with gone as (
      delete from ${cmPartnerships} where id in (${sql.join(unique.map((id) => sql`${id}::uuid`), sql`, `)})
      returning creator_id
    ), affected as (
      select distinct creator_id from gone
    ), orphaned as (
      delete from ${cmCreators} c
      where c.id in (select creator_id from affected)
        and not exists (select 1 from ${cmPartnerships} p where p.creator_id = c.id and p.id not in (${sql.join(unique.map((id) => sql`${id}::uuid`), sql`, `)}))
      returning c.id
    )
    select (select count(*)::int from gone) as removed,
           (select count(*)::int from orphaned) as deleted,
           coalesce((select json_agg(creator_id) from affected where creator_id not in (select id from orphaned)), '[]'::json) as kept
  `);
  const row = res.rows[0] as { removed: number; deleted: number; kept: string[] };
  const kept = row.kept ?? [];
  if (kept.length) await forgetSearchedAddresses(kept);
  return { removed: Number(row.removed), creatorsDeleted: Number(row.deleted), creatorsKept: kept.length };
}

/** Take a creator's addresses off the "already searched" list, so the next check re-files their mail. */
async function forgetSearchedAddresses(creatorIds: string[]): Promise<void> {
  const [creators, extra] = await Promise.all([
    db.select({ email: cmCreators.businessEmail }).from(cmCreators).where(inArray(cmCreators.id, creatorIds)),
    db.select({ email: cmCreatorEmails.email }).from(cmCreatorEmails).where(inArray(cmCreatorEmails.creatorId, creatorIds)),
  ]);
  const addresses = new Set([...creators, ...extra].map((r) => r.email?.trim().toLowerCase()).filter((a): a is string => !!a));
  if (!addresses.size) return;
  const accounts = await db.select({ id: cmGmailAccounts.id, list: cmGmailAccounts.backfilledAddresses }).from(cmGmailAccounts);
  for (const a of accounts) {
    const next = (a.list ?? []).filter((x) => !addresses.has(x));
    if (next.length !== (a.list ?? []).length) await db.update(cmGmailAccounts).set({ backfilledAddresses: next }).where(eq(cmGmailAccounts.id, a.id));
  }
}

/** Delete a campaign with all its partnerships; creators left with no campaign go too. */
export async function deleteCampaign(clientId: string, id: string): Promise<RemovalResult & { ok: boolean }> {
  const [c] = await db.select({ id: cmCampaigns.id }).from(cmCampaigns).where(and(eq(cmCampaigns.id, id), eq(cmCampaigns.clientId, clientId))).limit(1);
  if (!c) return { ok: false, removed: 0, creatorsDeleted: 0, creatorsKept: 0 };
  const ps = await db.select({ id: cmPartnerships.id }).from(cmPartnerships).where(eq(cmPartnerships.campaignId, id));
  const r = await removePartnerships(ps.map((p) => p.id));
  await db.delete(cmCampaigns).where(eq(cmCampaigns.id, id));
  return { ok: true, ...r };
}

/**
 * Move partnerships to another campaign. A creator can be in a campaign
 * once: rows whose creator is already there (or appears twice in this
 * selection) are skipped and reported, never merged.
 */
export async function moveToCampaign(ids: string[], campaignId: string): Promise<{ moved: number; skipped: number; prior: { id: string; campaignId: string }[] }> {
  const unique = [...new Set(ids)];
  if (!unique.length) return { moved: 0, skipped: 0, prior: [] };
  const rows = await db
    .select({ id: cmPartnerships.id, creatorId: cmPartnerships.creatorId, campaignId: cmPartnerships.campaignId })
    .from(cmPartnerships)
    .where(inArray(cmPartnerships.id, unique));
  const already = new Set(
    (await db.select({ creatorId: cmPartnerships.creatorId }).from(cmPartnerships).where(eq(cmPartnerships.campaignId, campaignId))).map((r) => r.creatorId),
  );
  const take: string[] = [];
  const prior: { id: string; campaignId: string }[] = [];
  let skipped = 0;
  for (const r of rows) {
    if (r.campaignId === campaignId) continue; // already there — nothing to do
    if (already.has(r.creatorId)) {
      skipped++;
      continue;
    }
    already.add(r.creatorId); // the same creator twice in one selection moves once
    take.push(r.id);
    prior.push({ id: r.id, campaignId: r.campaignId });
  }
  if (take.length) {
    await db.update(cmPartnerships).set({ campaignId, updatedAt: new Date() }).where(inArray(cmPartnerships.id, take));
  }
  return { moved: take.length, skipped, prior };
}

/**
 * Undo a campaign move (interaction review 2026-09-30): each back to the
 * campaign it came from — only while it's still in `movedTo` (a move someone
 * made since stands) and never onto a creator already in that campaign. One
 * statement.
 */
export async function restoreCampaigns(prior: { id: string; campaignId: string }[], movedTo: string): Promise<{ restored: number }> {
  if (!prior.length) return { restored: 0 };
  const values = sql.join(prior.map((p) => sql`(${p.id}::uuid, ${p.campaignId}::uuid)`), sql`, `);
  const res = await db.execute(sql`
    update ${cmPartnerships} p set campaign_id = v.campaign, updated_at = now()
    from (values ${values}) as v(id, campaign)
    where p.id = v.id and p.campaign_id = ${movedTo}::uuid
      and not exists (select 1 from ${cmPartnerships} q where q.creator_id = p.creator_id and q.campaign_id = v.campaign)
    returning p.id
  `);
  return { restored: (res.rows as unknown[]).length };
}

/* ── The campaign scope (sidebar selector) ──────────────────────── */

const COOKIE = "cm_campaign";

export async function getSelectedCampaignId(): Promise<string | null> {
  return (await cookies()).get(COOKIE)?.value || null;
}

export async function setSelectedCampaignId(id: string | null): Promise<void> {
  const store = await cookies();
  if (!id) store.delete(COOKIE);
  else store.set(COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

/** The campaign the pages are scoped to — null means "All campaigns" (also when the saved one is gone or belongs to another client). */
export async function resolveCampaign(clientId: string): Promise<{ id: string; name: string } | null> {
  const id = await getSelectedCampaignId();
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [c] = await db
    .select({ id: cmCampaigns.id, name: cmCampaigns.name })
    .from(cmCampaigns)
    .where(and(eq(cmCampaigns.id, id), eq(cmCampaigns.clientId, clientId)))
    .limit(1);
  return c ?? null;
}
