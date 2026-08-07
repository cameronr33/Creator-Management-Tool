/**
 * Untangles the product cells from the HELLA sheet, where a single cell can
 * hold several product URLs, a free-text category, and a quantity buried in
 * a note ("Two of each (full car)", "Wants 10 Sets of wipers for her fleet").
 */

export interface ParsedProduct {
  productName: string;
  productUrl: string | null;
  category: string | null;
  quantity: number;
  notes: string | null;
}

export interface ProductParseResult {
  products: ParsedProduct[];
  /** Set when the cell looked like it listed more items than we could split. */
  needsReview: boolean;
  reviewReason: string | null;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** Pulls a quantity out of a free-text note; defaults to 1. */
export function parseQuantity(note: string | null | undefined): number {
  const raw = (note ?? "").toLowerCase();
  if (!raw) return 1;

  // "10 sets", "10 x", "2 of each"
  const digits = raw.match(/(\d+)\s*(sets?\b|x\b|of each\b|pcs?\b|pairs?\b)/);
  if (digits) {
    const n = Number(digits[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }

  // "two of each", "three sets"
  const words = raw.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b\s*(sets?\b|of each\b|pairs?\b)/,
  );
  if (words) return WORD_NUMBERS[words[1]] ?? 1;

  return 1;
}

/** Splits a cell that may contain several URLs joined by " . ", commas or newlines. */
export function splitProductUrls(cell: string | null | undefined): string[] {
  const raw = (cell ?? "").trim();
  if (!raw) return [];
  const matches = raw.match(/https?:\/\/[^\s,]+/g) ?? [];
  return matches.map((u) => u.replace(/[.,;]+$/, ""));
}

/** "vision-plus-7-conversion-headlamps-single-sae-dot" -> "Vision Plus 7 Conversion Headlamps Single Sae Dot" */
export function nameFromUrl(url: string): string {
  const slug = url.split("/").filter(Boolean).pop() ?? url;
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function parseProducts(
  productCell: string | null | undefined,
  categoryCell: string | null | undefined,
  noteCell: string | null | undefined,
): ProductParseResult {
  const urls = splitProductUrls(productCell);
  const category = (categoryCell ?? "").trim() || null;
  const quantity = parseQuantity(noteCell);

  // A category listing several items (commas or slashes) is a signal the cell
  // was doing double duty. If we can't line those up with URLs, say so rather
  // than inventing a split.
  const categoryItemCount = category
    ? category.split(/,|\s+\/\s+/).map((s) => s.trim()).filter(Boolean).length
    : 0;

  let needsReview = false;
  let reviewReason: string | null = null;

  if (urls.length === 0) {
    if (!category) {
      return { products: [], needsReview: false, reviewReason: null };
    }
    if (categoryItemCount > 1) {
      needsReview = true;
      reviewReason = `Category lists ${categoryItemCount} items but no product URLs were given`;
    }
    return {
      products: [
        {
          productName: category,
          productUrl: null,
          category,
          quantity,
          notes: null,
        },
      ],
      needsReview,
      reviewReason,
    };
  }

  if (categoryItemCount > urls.length) {
    needsReview = true;
    reviewReason = `Category lists ${categoryItemCount} items but only ${urls.length} product URL(s) were found`;
  }

  const products = urls.map((url) => ({
    productName: nameFromUrl(url),
    productUrl: url,
    category,
    quantity,
    notes: null,
  }));

  return { products, needsReview, reviewReason };
}

/**
 * Campaign cells were used as a scratchpad — "Suspension / interested in
 * lights as well? Ditch lights, and light bar". Keep the leading token as the
 * campaign and preserve the rest as a note.
 */
export function splitCampaignCell(cell: string | null | undefined): {
  campaign: string | null;
  note: string | null;
} {
  const raw = (cell ?? "").trim();
  if (!raw) return { campaign: null, note: null };

  const idx = raw.indexOf(" / ");
  if (idx === -1) return { campaign: raw, note: null };

  return {
    campaign: raw.slice(0, idx).trim(),
    note: raw.slice(idx + 3).trim() || null,
  };
}
