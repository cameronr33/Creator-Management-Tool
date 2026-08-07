/**
 * Pure transformation from the two HELLA CSV exports into insert-ready records
 * plus a conflict report. No database access, so it can be unit-tested offline
 * against the real files before anything is provisioned.
 *
 * import-hella.ts consumes buildImportPlan() and does the actual writes.
 */
import {
  parseCsvWithHeaderAt,
  toInt,
  toFloat,
  toBool,
  toViewCount,
  parseDateRange,
  normalizeUsername,
  normalizeInstagramUrl,
  instagramShortcode,
  type CsvRow,
} from "./csv";
import { parseAddress, type ParsedAddress } from "./address";
import { parseProducts, splitCampaignCell, type ParsedProduct } from "./products";
import type { CmStage } from "./db/schema";

export interface Conflict {
  creator: string;
  field: string;
  tracker: string;
  shipping: string;
  imported: string;
  reason: string;
}
export interface Flag {
  creator: string;
  issue: string;
}

export interface ReelRecord {
  rank: number;
  url: string;
  shortcode: string | null;
  views: number | null;
  description: string | null;
}
export interface OutreachRecord {
  direction: "outbound" | "inbound";
  channel: "ig_dm";
  kind: "initial" | "follow_up" | "reply";
  isMigrated: true;
}
export interface ImportRecord {
  name: string;
  username: string;
  profileUrl: string;
  businessEmail: string | null;
  contentPillar: string | null;
  followers: number | null;
  reelsPulled: number | null;
  cadencePerWeek: number | null;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  avgViews: number | null;
  medianViews: number | null;
  maxViews: number | null;
  viewsSource: "ig_public_chrome" | "apify" | null;
  contentTypeSummary: string | null;
  creatorNotes: string | null;
  reels: ReelRecord[];

  campaignName: string;
  stage: CmStage;
  agreementType: "verbal" | "signed" | null;
  compensationType: "free_product" | "flat_fee" | "hybrid";
  exitReason: string | null;
  partnershipNotes: string | null;

  address: ParsedAddress | null;
  addressRaw: string | null;
  products: ParsedProduct[];

  needsShipment: boolean;
  shipmentStatus: "ready" | "shipped" | null;
  outreach: OutreachRecord[];
}

export interface ImportPlan {
  records: ImportRecord[];
  conflicts: Conflict[];
  flags: Flag[];
  stageTally: Record<string, number>;
  trackerCount: number;
  shippingCount: number;
}

const STATUS_RANK: Record<string, number> = {
  "": 0,
  "in contact": 1,
  "verbal agreement": 2,
  signed: 3,
  pass: 1,
};
function statusRank(s: string): number {
  return STATUS_RANK[s.trim().toLowerCase()] ?? 0;
}

function namesTerms(note: string): boolean {
  const n = note.toLowerCase();
  return /\b(fee|flat fee|rate|price|money|budget)\b/.test(n) || /fully agree/.test(n);
}
function wantsFlatFee(note: string): boolean {
  return /flat fee/.test(note.toLowerCase());
}

interface StageInputs {
  shortlistPass: string;
  status: string;
  messaged: boolean;
  hasAddress: boolean;
  productSent: boolean;
  videoCreated: boolean;
  dealNote: string;
}
interface StageResult {
  stage: CmStage;
  agreementType: "verbal" | "signed" | null;
  compensationType: "free_product" | "flat_fee" | "hybrid";
  exitReason: string | null;
  needsShipment: boolean;
  reviewNote: string | null;
}

export function deriveStage(i: StageInputs): StageResult {
  const status = i.status.trim().toLowerCase();
  const shortlist = i.shortlistPass.trim().toLowerCase();

  const base: StageResult = {
    stage: "researched",
    agreementType: null,
    compensationType: "free_product",
    exitReason: null,
    needsShipment: false,
    reviewNote: null,
  };

  if (status === "signed" || status === "verbal agreement") {
    base.agreementType = status === "signed" ? "signed" : "verbal";
    if (i.videoCreated) {
      base.stage = "posted";
      base.needsShipment = true;
    } else if (i.productSent) {
      base.stage = "content_pending";
      base.needsShipment = true;
    } else if (i.hasAddress) {
      base.stage = "fulfilling";
      base.needsShipment = true;
    } else {
      base.stage = "awaiting_address";
    }
    return base;
  }

  if (status === "in contact") {
    if (namesTerms(i.dealNote)) {
      base.stage = "negotiating";
      if (wantsFlatFee(i.dealNote)) base.compensationType = "flat_fee";
    } else {
      base.stage = "in_conversation";
    }
    return base;
  }

  if (status === "pass") {
    base.stage = "passed";
    base.exitReason = null;
    base.reviewNote =
      "Status=Pass after outreach — set passed vs declined manually (address/product present)";
    return base;
  }

  if (shortlist === "pass") {
    base.stage = "passed";
    base.exitReason = "research_fit";
    return base;
  }
  if (i.messaged) {
    base.stage = "contacted";
    return base;
  }
  if (shortlist === "shortlist") {
    base.stage = "shortlisted";
    return base;
  }
  return base;
}

export function viewsSourceOf(raw: string): "ig_public_chrome" | "apify" | null {
  const s = raw.toLowerCase();
  if (!s) return null;
  if (s.includes("chrome") || s.includes("ig public")) return "ig_public_chrome";
  if (s.includes("apify")) return "apify";
  return null;
}

export function buildImportPlan(trackerText: string, shippingText: string): ImportPlan {
  const conflicts: Conflict[] = [];
  const flags: Flag[] = [];
  const stageTally: Record<string, number> = {};

  const tracker = parseCsvWithHeaderAt(trackerText, [
    "Username",
    "Shortlist/Pass",
    "Status",
    "Product Sent",
  ]);
  const shipping = parseCsvWithHeaderAt(shippingText, [
    "Username",
    "Status",
    "Product Category",
    "Shipping Address",
  ]);

  const trackerRows = tracker.rows.filter((r) => (r["Username"] ?? "").trim() !== "");
  const shippingByUser = new Map<string, CsvRow>();
  for (const r of shipping.rows) {
    const u = normalizeUsername(r["Username"] ?? "");
    if (u) shippingByUser.set(u, r);
  }

  const trackerUsers = new Set(trackerRows.map((t) => normalizeUsername(t["Username"] ?? "")));
  for (const [u, row] of shippingByUser) {
    if (!trackerUsers.has(u)) {
      flags.push({ creator: row["Name"] || u, issue: "In shipping sheet but not the tracker — not imported" });
    }
  }

  const records: ImportRecord[] = [];

  for (const t of trackerRows) {
    const username = normalizeUsername(t["Username"] ?? t["Name"] ?? "");
    const s = shippingByUser.get(username) ?? null;
    const name = (t["Name"] || username).trim();

    // Merge deal status.
    const trackerStatus = (t["Status"] ?? "").trim();
    const shippingStatus = (s?.["Status"] ?? "").trim();
    let status = trackerStatus;
    if (s && statusRank(shippingStatus) > statusRank(trackerStatus)) {
      status = shippingStatus;
      conflicts.push({
        creator: name,
        field: "Status",
        tracker: trackerStatus || "(blank)",
        shipping: shippingStatus || "(blank)",
        imported: shippingStatus,
        reason: "shipping sheet is more advanced (and carries product/address)",
      });
    } else if (s && shippingStatus && statusRank(shippingStatus) < statusRank(trackerStatus)) {
      conflicts.push({
        creator: name,
        field: "Status",
        tracker: trackerStatus,
        shipping: shippingStatus,
        imported: trackerStatus,
        reason: "tracker is more advanced",
      });
    }

    // Address.
    const trackerAddr = (t["Shipping Address"] ?? "").trim();
    const shippingAddr = (s?.["Shipping Address"] ?? "").trim();
    let addrRaw = trackerAddr || shippingAddr;
    if (trackerAddr && shippingAddr && trackerAddr !== shippingAddr) {
      conflicts.push({
        creator: name,
        field: "Shipping Address",
        tracker: trackerAddr,
        shipping: shippingAddr,
        imported: trackerAddr,
        reason: "both present and differ — kept tracker",
      });
      addrRaw = trackerAddr;
    }
    const address = parseAddress(addrRaw);
    const hasAddress = !!address && !!(address.addressLine1 || address.city);
    if (address && !address.isComplete && addrRaw) {
      flags.push({ creator: name, issue: `Incomplete address (${address.issues.join(", ")}): "${addrRaw}"` });
    }

    // Notes.
    const dealNote = [t["Notes"], t["Notes__2"], s?.["Notes"]]
      .filter((x) => x && x.trim())
      .join(" — ") as string;

    // Products. The tracker has no "Product Category" column — only a Product
    // URL column — so we must NOT fall back to Campaign as a category, or a
    // creator with no product (Nico) would get a phantom "Evergreen Creators"
    // product. Categories come from the shipping sheet, merged in by URL.
    const trackerProducts = parseProducts(t["Product"], null, dealNote);
    const shippingProducts = parseProducts(s?.["Product"], s?.["Product Category"], s?.["Notes"]);
    if (trackerProducts.needsReview) flags.push({ creator: name, issue: trackerProducts.reviewReason! });
    if (shippingProducts.needsReview) flags.push({ creator: name, issue: shippingProducts.reviewReason! });

    // Product / deal-note conflict. The two sheets store the deal in different
    // columns — the tracker in its Notes cell, the shipping sheet in Product
    // Category + Notes — so compare those. Flag only when neither description
    // contains the other, which keeps enrichment ("Lights" -> "Looking for
    // lights on site") from reading as a disagreement while still catching
    // Michael Dey ("Video with two products" vs "Headlight and Tail lights").
    const trackerDeal = (t["Notes"] ?? "").trim();
    const shippingDeal = [s?.["Product Category"], s?.["Notes"]]
      .filter((x) => x && x.trim())
      .join(" — ")
      .trim();
    if (trackerDeal && shippingDeal) {
      const a = trackerDeal.toLowerCase();
      const b = shippingDeal.toLowerCase();
      if (!a.includes(b) && !b.includes(a)) {
        conflicts.push({
          creator: name,
          field: "Product / notes",
          tracker: trackerDeal,
          shipping: shippingDeal,
          imported: `${trackerDeal} + ${shippingDeal}`,
          reason: "sheets describe the deal differently — kept both, please confirm",
        });
      }
    }

    const productMap = new Map<string, ParsedProduct>();
    for (const p of [...trackerProducts.products, ...shippingProducts.products]) {
      productMap.set((p.productUrl ?? p.productName).toLowerCase(), p);
    }
    const products = [...productMap.values()];

    // Campaign.
    const { campaign, note: campaignNote } = splitCampaignCell(
      t["Campaign"] || s?.["Product Category"] || "Evergreen Creators",
    );
    const campaignName = campaign || "Evergreen Creators";

    // Stage.
    const messaged = toBool(t["Messaged"]);
    const productSent = toBool(t["Product Sent"]) || toBool(s?.["Product Sent"]);
    const videoCreated = toBool(t["Video Created"]) || toBool(s?.["Video Created"]);
    const stageRes = deriveStage({
      shortlistPass: t["Shortlist/Pass"] ?? "",
      status,
      messaged,
      hasAddress,
      productSent,
      videoCreated,
      dealNote,
    });
    if (stageRes.reviewNote) flags.push({ creator: name, issue: stageRes.reviewNote });
    stageTally[stageRes.stage] = (stageTally[stageRes.stage] ?? 0) + 1;

    // Reels.
    const reels: ReelRecord[] = [];
    for (let rank = 1; rank <= 3; rank++) {
      const url = (t[`Top Reel #${rank} Link`] || "").trim();
      if (!url) continue;
      reels.push({
        rank,
        url,
        shortcode: instagramShortcode(url),
        views: toViewCount(t[`Top Reel #${rank} Views`]),
        description: (t[`Top Reel #${rank} Description`] || "").trim() || null,
      });
    }

    // Outreach events.
    const outreach: OutreachRecord[] = [];
    if (messaged) outreach.push({ direction: "outbound", channel: "ig_dm", kind: "initial", isMigrated: true });
    if (toBool(t["Follow up 1"])) outreach.push({ direction: "outbound", channel: "ig_dm", kind: "follow_up", isMigrated: true });
    if (toBool(t["Follow up 2"])) outreach.push({ direction: "outbound", channel: "ig_dm", kind: "follow_up", isMigrated: true });
    if (["in contact", "verbal agreement", "signed"].includes(status.trim().toLowerCase())) {
      outreach.push({ direction: "inbound", channel: "ig_dm", kind: "reply", isMigrated: true });
    }

    const dr = parseDateRange(t["Date Range"]);
    records.push({
      name,
      username,
      profileUrl: normalizeInstagramUrl(t["Instagram Link"] || username),
      businessEmail: (t["Business Email"] || "").trim() || null,
      contentPillar: (t["Content Pillar"] || "").trim() || null,
      followers: toInt(t["Followers"]),
      reelsPulled: toInt(t["Reels Pulled"]),
      cadencePerWeek: toFloat(t["Posting Cadence (reels/wk)"]),
      dateRangeStart: dr.start,
      dateRangeEnd: dr.end,
      avgViews: toInt(t["Avg Views (IG)"]),
      medianViews: toInt(t["Median Views (IG)"]),
      maxViews: toInt(t["Max Views (IG)"]),
      viewsSource: viewsSourceOf(t["Views Source"] ?? ""),
      contentTypeSummary: (t["Content Type Summary"] || "").trim() || null,
      creatorNotes: (t["Notes__2"] || "").trim() || null,
      reels,
      campaignName,
      stage: stageRes.stage,
      agreementType: stageRes.agreementType,
      compensationType: stageRes.compensationType,
      exitReason: stageRes.exitReason,
      partnershipNotes: [dealNote, campaignNote].filter(Boolean).join(" — ") || null,
      address,
      addressRaw: addrRaw || null,
      products,
      needsShipment: stageRes.needsShipment,
      shipmentStatus: stageRes.needsShipment ? (productSent || videoCreated ? "shipped" : "ready") : null,
      outreach,
    });
  }

  return {
    records,
    conflicts,
    flags,
    stageTally,
    trackerCount: trackerRows.length,
    shippingCount: shippingByUser.size,
  };
}
