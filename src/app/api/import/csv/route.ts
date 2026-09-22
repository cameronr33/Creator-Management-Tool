import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, badRequest } from "@/lib/api-helpers";
import {
  parseCsvWithHeaderAt,
  toInt,
  toFloat,
  toViewCount,
  parseDateRange,
} from "@/lib/csv";
import { ingestResearch, type IngestCreator, type IngestPayload } from "@/lib/ingest";
import { viewsSourceOf } from "@/lib/csv";

/**
 * Manual CSV upload path — accepts a creator-research skill CSV (same columns
 * the skill emits) and feeds it through the same ingest pipeline as the API.
 * Rows are grouped by their Campaign column; a form `campaign` field is the
 * fallback for rows that don't name one.
 */
export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("Expected multipart form data");

  const file = form.get("file");
  const client = String(form.get("client") ?? "");
  const fallbackCampaign = String(form.get("campaign") ?? "").trim();

  if (!client) return badRequest("Missing client");
  if (!(file instanceof File)) return badRequest("Missing CSV file");

  const text = await file.text();
  let parsed;
  try {
    parsed = parseCsvWithHeaderAt(text, ["Username", "Followers"]);
  } catch (e) {
    return badRequest(`Could not parse CSV: ${(e as Error).message}`);
  }

  const rows = parsed.rows.filter((r) => (r["Username"] ?? "").trim() !== "");
  if (rows.length === 0) return badRequest("No creator rows found in CSV");

  // Group rows by campaign.
  const byCampaign = new Map<string, IngestCreator[]>();
  for (const r of rows) {
    const campaign = (r["Campaign"] || fallbackCampaign || "Imported").trim();
    const creator: IngestCreator = {
      name: (r["Name"] || r["Username"]).trim(),
      username: r["Username"].trim(),
      profileUrl: (r["Instagram Link"] || "").trim() || undefined,
      businessEmail: (r["Business Email"] || "").trim() || null,
      contentPillar: (r["Content Pillar"] || "").trim() || null,
      followers: toInt(r["Followers"]),
      reelsPulled: toInt(r["Reels Pulled"]),
      cadencePerWeek: toFloat(r["Posting Cadence (reels/wk)"]),
      dateRangeStart: parseDateRange(r["Date Range"]).start,
      dateRangeEnd: parseDateRange(r["Date Range"]).end,
      avgViews: toInt(r["Avg Views (IG)"]),
      medianViews: toInt(r["Median Views (IG)"]),
      maxViews: toInt(r["Max Views (IG)"]),
      viewsSource: viewsSourceOf(r["Views Source"] ?? ""),
      contentTypeSummary: (r["Content Type Summary"] || "").trim() || null,
      reels: [1, 2, 3]
        .map((rank) => {
          const url = (r[`Top Reel #${rank} Link`] || "").trim();
          if (!url) return null;
          return {
            rank,
            url,
            views: toViewCount(r[`Top Reel #${rank} Views`]),
            description: (r[`Top Reel #${rank} Description`] || "").trim() || null,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    };
    const arr = byCampaign.get(campaign) ?? [];
    arr.push(creator);
    byCampaign.set(campaign, arr);
  }

  const results = [];
  try {
    for (const [campaign, creators] of byCampaign) {
      const payload: IngestPayload = { client, campaign, creators };
      results.push(await ingestResearch(payload, "csv_upload"));
    }
  } catch (e) {
    return badRequest((e as Error).message);
  }

  const created = results.reduce((s, r) => s + r.created, 0);
  const updated = results.reduce((s, r) => s + r.updated, 0);
  return NextResponse.json({ ok: true, campaigns: results.length, created, updated });
}
