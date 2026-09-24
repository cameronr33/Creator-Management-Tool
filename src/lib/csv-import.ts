import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmCreators, cmPartnerships } from "@/lib/db/schema";
import { parseCsvMatrix, toFloat, toInt, viewsSourceOf } from "@/lib/csv";
import { parseSocialUrl } from "@/lib/social-links";
import { ensureCampaign, findCampaignByName, normalizeCampaignName } from "@/lib/campaigns";
import { createCreatorWithPartnership } from "@/lib/creators";

/**
 * Creators → Import CSV. A plain list works: a Name column, and a Campaign
 * column written out in words — campaigns are matched ignoring case and
 * spacing, and created when missing. Instagram and Email are optional, and
 * the creator-research CSV still imports (its numbers come along).
 *
 * Two passes: `planImport` reads only and says exactly what will happen, row
 * by row; `applyImport` does it. Importing the same file twice changes nothing.
 * Existing creators only get empty fields filled, and hand-checked view counts
 * are never replaced by estimated ones (frozen node 1).
 */

/* ── Reading the file (pure) ─────────────────────────────────────── */

const ALIASES = {
  name: ["name", "creator", "creator name", "full name"],
  instagram: ["instagram", "username", "handle", "ig", "instagram link", "instagram url", "profile", "profile link", "profile url", "instagram handle"],
  campaign: ["campaign", "campaign name"],
  email: ["email", "business email", "e-mail", "email address"],
  contentPillar: ["content pillar", "content type"],
  followers: ["followers"],
  notes: ["notes", "note"],
  avgViews: ["avg views (ig)", "avg views"],
  medianViews: ["median views (ig)", "median views"],
  maxViews: ["max views (ig)", "max views"],
  cadence: ["posting cadence (reels/wk)", "posting cadence"],
  viewsSource: ["views source"],
} as const;
type Field = keyof typeof ALIASES;

const key = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

export interface ImportRow {
  /** Line in the file (1-based, as a spreadsheet shows it). */
  line: number;
  name: string;
  /** Instagram handle, lowercased; null for a name-only row. */
  handle: string | null;
  /** The pasted link as given (any platform), or null. */
  link: string | null;
  campaign: string;
  email: string | null;
  contentPillar: string | null;
  followers: number | null;
  notes: string | null;
  avgViews: number | null;
  medianViews: number | null;
  maxViews: number | null;
  cadence: number | null;
  viewsSource: "ig_public_chrome" | "apify" | null;
}

export interface ParsedFile {
  rows: ImportRow[];
  problems: { line: number; message: string }[];
  /** Header text found for each field — shown so people can see what was read. */
  columns: Partial<Record<Field, string>>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The Instagram column: a link (any platform) or a bare handle. A bare
 * "@some.one" is a handle, not a website — Instagram handles contain dots.
 */
function readProfile(raw: string): ReturnType<typeof parseSocialUrl> {
  const t = raw.trim();
  // A link has a slash ("instagram.com/x", "https://…"); "@jane.co" or "jane.co" is a handle.
  if (t.includes("/")) return parseSocialUrl(t);
  const handle = t.replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(handle) ? { platform: "instagram", handle, url: `https://www.instagram.com/${handle}` } : null;
}

export function parseImportFile(text: string, defaultCampaign: string): ParsedFile {
  const matrix = parseCsvMatrix(text);
  const isNameOrHandle = (c: string) => (ALIASES.name as readonly string[]).includes(key(c)) || (ALIASES.instagram as readonly string[]).includes(key(c));
  const headerIndex = matrix.findIndex((row) => row.some(isNameOrHandle));
  if (headerIndex === -1) {
    return { rows: [], problems: [{ line: 1, message: "No header row found. The first row needs a Name column (or Instagram)." }], columns: {} };
  }
  const header = matrix[headerIndex];
  const col: Partial<Record<Field, number>> = {};
  const columns: Partial<Record<Field, string>> = {};
  for (const field of Object.keys(ALIASES) as Field[]) {
    const i = header.findIndex((h) => (ALIASES[field] as readonly string[]).includes(key(h)));
    if (i >= 0) {
      col[field] = i;
      columns[field] = header[i].trim();
    }
  }

  const rows: ImportRow[] = [];
  const problems: ParsedFile["problems"] = [];
  const seen = new Map<string, number>();
  const fallback = normalizeCampaignName(defaultCampaign) || "General";
  // One spelling per campaign: the first one in the file ("Spring" and "spring" are one campaign).
  const spelling = new Map<string, string>();

  for (let r = headerIndex + 1; r < matrix.length; r++) {
    const cells = matrix[r];
    if (cells.every((c) => c.trim() === "")) continue;
    const line = r + 1;
    const get = (f: Field) => (col[f] === undefined ? "" : (cells[col[f]!] ?? "").trim());

    const rawLink = get("instagram");
    const parsedLink = rawLink ? readProfile(rawLink) : null;
    if (rawLink && !parsedLink) {
      problems.push({ line, message: `Couldn't read "${rawLink}" as a profile link or handle.` });
      continue;
    }
    const handle = parsedLink?.platform === "instagram" ? parsedLink.handle?.toLowerCase() ?? null : null;
    const name = get("name") || handle || "";
    if (!name) {
      problems.push({ line, message: "No name and no Instagram handle — nothing to add." });
      continue;
    }
    const email = get("email").toLowerCase() || null;
    if (email && !EMAIL.test(email)) {
      problems.push({ line, message: `"${email}" isn't an email address.` });
      continue;
    }
    const typed = normalizeCampaignName(get("campaign")) || fallback;
    if (!spelling.has(typed.toLowerCase())) spelling.set(typed.toLowerCase(), typed);
    const campaign = spelling.get(typed.toLowerCase())!;
    const dedupe = `${(handle ?? `name:${name.toLowerCase()}`)}|${campaign.toLowerCase()}`;
    if (seen.has(dedupe)) {
      problems.push({ line, message: `Same creator and campaign as line ${seen.get(dedupe)} — skipped.` });
      continue;
    }
    seen.set(dedupe, line);
    rows.push({
      line,
      name,
      handle,
      link: parsedLink ? parsedLink.url : null,
      campaign,
      email,
      contentPillar: get("contentPillar") || null,
      followers: toInt(get("followers")),
      notes: get("notes") || null,
      avgViews: toInt(get("avgViews")),
      medianViews: toInt(get("medianViews")),
      maxViews: toInt(get("maxViews")),
      cadence: toFloat(get("cadence")),
      viewsSource: viewsSourceOf(get("viewsSource")),
    });
  }
  return { rows, problems, columns };
}

/* ── What will happen (reads only) ───────────────────────────────── */

export type RowOutcome = "new" | "added_to_campaign" | "already_there";

export interface ImportPlan {
  rows: (ImportRow & { outcome: RowOutcome; existingName: string | null })[];
  problems: ParsedFile["problems"];
  columns: ParsedFile["columns"];
  /** Campaign names that don't exist yet and will be created. */
  newCampaigns: string[];
  counts: Record<RowOutcome, number>;
}

async function findExisting(clientId: string, rows: ImportRow[]) {
  const handles = [...new Set(rows.map((r) => r.handle).filter((h): h is string => !!h))];
  const names = [...new Set(rows.filter((r) => !r.handle).map((r) => r.name.toLowerCase()))];
  const [byHandle, byName] = await Promise.all([
    handles.length
      ? db
          .select({ id: cmCreators.id, name: cmCreators.name, username: cmCreators.username })
          .from(cmCreators)
          .where(and(eq(cmCreators.clientId, clientId), inArray(sql`lower(${cmCreators.username})`, handles)))
      : Promise.resolve([]),
    names.length
      ? db
          .select({ id: cmCreators.id, name: cmCreators.name })
          .from(cmCreators)
          .where(and(eq(cmCreators.clientId, clientId), inArray(sql`lower(${cmCreators.name})`, names)))
      : Promise.resolve([]),
  ]);
  const handleMap = new Map(byHandle.map((c) => [c.username.toLowerCase(), c]));
  // A name-only row joins an existing creator only when exactly one has that name.
  const nameCount = new Map<string, { id: string; name: string }[]>();
  for (const c of byName) nameCount.set(c.name.toLowerCase(), [...(nameCount.get(c.name.toLowerCase()) ?? []), c]);
  return (r: ImportRow): { id: string; name: string } | null | { ambiguous: number } => {
    if (r.handle) return handleMap.get(r.handle) ?? null;
    const hits = nameCount.get(r.name.toLowerCase()) ?? [];
    return hits.length === 1 ? hits[0] : hits.length > 1 ? { ambiguous: hits.length } : null;
  };
}

type Match = ReturnType<Awaited<ReturnType<typeof findExisting>>>;
const isAmbiguous = (m: Match): m is { ambiguous: number } => !!m && "ambiguous" in m;
const ambiguousMessage = (r: ImportRow, n: number) => `${n} creators are already named "${r.name}" — add their Instagram so it's clear which one.`;

export async function planImport(clientId: string, parsed: ParsedFile): Promise<ImportPlan> {
  const existing = await findExisting(clientId, parsed.rows);
  const campaignIds = new Map<string, string | null>();
  for (const name of new Set(parsed.rows.map((r) => r.campaign))) {
    campaignIds.set(name, (await findCampaignByName(clientId, name))?.id ?? null);
  }
  const problems = [...parsed.problems];
  const usable = parsed.rows.filter((r) => {
    const m = existing(r);
    if (isAmbiguous(m)) problems.push({ line: r.line, message: ambiguousMessage(r, m.ambiguous) });
    return !isAmbiguous(m);
  });
  const known = (r: ImportRow) => existing(r) as { id: string; name: string } | null;
  const creatorIds = usable.map((r) => known(r)?.id).filter((x): x is string => !!x);
  const memberships = creatorIds.length
    ? await db
        .select({ creatorId: cmPartnerships.creatorId, campaignId: cmPartnerships.campaignId })
        .from(cmPartnerships)
        .where(inArray(cmPartnerships.creatorId, [...new Set(creatorIds)]))
    : [];
  const counts: Record<RowOutcome, number> = { new: 0, added_to_campaign: 0, already_there: 0 };
  const rows = usable.map((r) => {
    const c = known(r);
    const campaignId = campaignIds.get(r.campaign);
    const outcome: RowOutcome = !c
      ? "new"
      : campaignId && memberships.some((m) => m.creatorId === c.id && m.campaignId === campaignId)
        ? "already_there"
        : "added_to_campaign";
    counts[outcome]++;
    return { ...r, outcome, existingName: c?.name ?? null };
  });
  const newCampaigns = [...campaignIds.entries()].filter(([, id]) => !id).map(([name]) => name);
  const used = new Set(usable.map((r) => r.campaign));
  return { rows, problems: problems.sort((a, b) => a.line - b.line), columns: parsed.columns, newCampaigns: newCampaigns.filter((n) => used.has(n)), counts };
}

/* ── Doing it ────────────────────────────────────────────────────── */

export interface ImportResult {
  created: number;
  addedToCampaign: number;
  alreadyThere: number;
  campaignsCreated: string[];
  failed: { line: number; message: string }[];
  /** Creators that are new or gained a campaign — photos and email are fetched for these. */
  touchedCreatorIds: string[];
  withEmail: number;
}

export async function applyImport(clientId: string, parsed: ParsedFile, userId?: string): Promise<ImportResult> {
  const result: ImportResult = { created: 0, addedToCampaign: 0, alreadyThere: 0, campaignsCreated: [], failed: [], touchedCreatorIds: [], withEmail: 0 };
  const existing = await findExisting(clientId, parsed.rows);
  const campaignIds = new Map<string, string>();
  for (const row of parsed.rows) {
    try {
      let campaignId = campaignIds.get(row.campaign);
      if (!campaignId) {
        const c = await ensureCampaign(clientId, row.campaign);
        campaignId = c.id;
        campaignIds.set(row.campaign, c.id);
        if (c.created) result.campaignsCreated.push(c.name);
      }
      const match = existing(row);
      if (isAmbiguous(match)) {
        result.failed.push({ line: row.line, message: ambiguousMessage(row, match.ambiguous) });
        continue;
      }
      const known = match;
      const r = await createCreatorWithPartnership({
        clientId,
        name: known?.name ?? row.name,
        // A known name-only creator is matched by id below; links only for handles/links in the file.
        links: row.link ? [row.link] : [],
        campaignId,
        stage: "shortlisted",
        businessEmail: row.email,
        contentPillar: row.contentPillar,
        followers: row.followers,
        notes: row.notes,
        userId,
        existingCreatorId: known?.id,
        // A name-only row with no single match is a new person — exactly what the
        // preview said — never attached to whoever's handle happens to equal the name's slug.
        forceNew: !known && !row.link,
      });
      if (!r.reusedCreator) result.created++;
      else if (!r.reusedPartnership) result.addedToCampaign++;
      else result.alreadyThere++;
      if (!r.reusedPartnership) result.touchedCreatorIds.push(r.creatorId);
      if (row.email) result.withEmail++;
      await writeNumbers(r.creatorId, row);
    } catch (e) {
      result.failed.push({ line: row.line, message: (e as Error).message });
    }
  }
  return result;
}

/**
 * The research numbers, when the file carries them. Like every other field
 * they only fill what's empty — with one exception: hand-checked views
 * (ig_public_chrome) replace views that aren't hand-checked. Nothing ever
 * replaces hand-checked views (frozen node 1).
 */
async function writeNumbers(creatorId: string, row: ImportRow) {
  const hasViews = row.avgViews != null || row.medianViews != null || row.maxViews != null;
  if (!hasViews && row.cadence == null) return;
  const [cur] = await db
    .select({ viewsSource: cmCreators.viewsSource, avgViews: cmCreators.avgViews, medianViews: cmCreators.medianViews, maxViews: cmCreators.maxViews, cadence: cmCreators.cadencePerWeek })
    .from(cmCreators)
    .where(eq(cmCreators.id, creatorId))
    .limit(1);
  if (!cur) return;
  const haveViews = cur.avgViews != null || cur.medianViews != null || cur.maxViews != null;
  const upgrade = row.viewsSource === "ig_public_chrome" && cur.viewsSource !== "ig_public_chrome";
  const writeViews = hasViews && (!haveViews || upgrade);
  await db
    .update(cmCreators)
    .set({
      ...(writeViews
        ? { avgViews: row.avgViews ?? null, medianViews: row.medianViews ?? null, maxViews: row.maxViews ?? null, viewsSource: row.viewsSource ?? null }
        : {}),
      cadencePerWeek: row.cadence != null && cur.cadence == null ? String(row.cadence) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(cmCreators.id, creatorId));
}
