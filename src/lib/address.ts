/**
 * Parses the single-line addresses the HELLA sheet stores, e.g.
 *   "Joe Hubbard, 3333 Simeon Bunker St, Saint Charles, Missouri, 63301"
 *   "Anton Mendez, 7747 Lakeside Drive, Jurupa Valley, CA 92509"
 *   "Nico Dente, 3005 W Gray St., Tampa Fl, 33609"
 *   "Mikey Sneed, 2200 Shady Tree Ln, Texas, 77301"   <- no city at all
 *
 * The shapes are inconsistent, so anything that doesn't parse cleanly is
 * reported rather than guessed at — a wrong address means a lost package.
 */

const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC",
};

const STATE_CODES = new Set(Object.values(US_STATES));

export interface ParsedAddress {
  recipientName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string;
  raw: string;
  /** True only when line1, city, region and postalCode all resolved. */
  isComplete: boolean;
  /** Human-readable notes about what could not be determined. */
  issues: string[];
}

function normalizeState(token: string): string | null {
  const t = token.trim();
  if (t.length === 2 && STATE_CODES.has(t.toUpperCase())) return t.toUpperCase();
  const full = US_STATES[t.toLowerCase()];
  return full ?? null;
}

function looksLikeStreet(token: string): boolean {
  return /^\d/.test(token.trim()) || /\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|way|pl|place|ct|court|hwy|circle|cir|trail|trl)\b\.?$/i.test(token.trim());
}

export function parseAddress(input: string | null | undefined): ParsedAddress | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  const result: ParsedAddress = {
    recipientName: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    region: null,
    postalCode: null,
    country: "US",
    raw,
    isComplete: false,
    issues: [],
  };

  // Addresses pasted from a DM arrive one line per part; sheet addresses use
  // commas. Both split the same way.
  const parts = raw
    .split(/[,\n]+/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length === 0) {
    result.issues.push("empty address");
    return result;
  }

  // A trailing country line ("United States", "USA") is noise for a US-only parser.
  if (parts.length > 1 && /^(united states( of america)?|u\.?s\.?a?\.?)$/i.test(parts[parts.length - 1])) {
    parts.pop();
  }

  // Leading part is the recipient name when it has no digits.
  if (parts.length > 1 && !/\d/.test(parts[0])) {
    result.recipientName = parts.shift() ?? null;
  }

  // Work backwards from the end, which is where the structured bits live.
  if (parts.length > 0) {
    const last = parts[parts.length - 1];

    // "92509" or "92509-1234"
    if (/^\d{5}(-\d{4})?$/.test(last)) {
      result.postalCode = last;
      parts.pop();
    } else {
      // "CA 92509" / "Missouri 63301"
      const stateZip = last.match(/^(.+?)\s+(\d{5}(?:-\d{4})?)$/);
      if (stateZip) {
        const state = normalizeState(stateZip[1]);
        if (state) {
          result.region = state;
          result.postalCode = stateZip[2];
          parts.pop();
        }
      }
    }
  }

  // Next from the end: a bare state, or a jammed "Tampa Fl".
  if (parts.length > 0 && !result.region) {
    const last = parts[parts.length - 1];
    const state = normalizeState(last);
    if (state) {
      result.region = state;
      parts.pop();
    } else {
      const cityState = last.match(/^(.+?)\s+([A-Za-z]{2})$/);
      if (cityState && normalizeState(cityState[2])) {
        result.city = cityState[1].trim();
        result.region = normalizeState(cityState[2]);
        parts.pop();
      }
    }
  }

  // Whatever is now last is the city, unless it reads as a street line.
  if (parts.length > 0 && !result.city) {
    const last = parts[parts.length - 1];
    if (parts.length > 1 || !looksLikeStreet(last)) {
      result.city = last;
      parts.pop();
    }
  }

  if (parts.length > 0) {
    result.addressLine1 = parts.shift() ?? null;
  }
  if (parts.length > 0) {
    result.addressLine2 = parts.join(", ");
  }

  if (!result.addressLine1) result.issues.push("no street line");
  if (!result.city) result.issues.push("no city");
  if (!result.region) result.issues.push("no state");
  if (!result.postalCode) result.issues.push("no postal code");

  result.isComplete = result.issues.length === 0;
  return result;
}

export function formatAddress(a: {
  recipientName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
}): string {
  const cityLine = [a.city, a.region].filter(Boolean).join(", ");
  const lastLine = [cityLine, a.postalCode].filter(Boolean).join(" ");
  const country = a.country && !/^(us|usa|united states)$/i.test(a.country.trim()) ? a.country.trim() : null;
  return [a.recipientName, a.addressLine1, a.addressLine2, lastLine, country]
    .filter((p) => p && p.trim() !== "")
    .join("\n");
}

/** Enough to ship to: street, city, state and postal code all present. */
export function hasCompleteAddress(a: {
  addressLine1?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
}): boolean {
  return !!(a.addressLine1?.trim() && a.city?.trim() && a.region?.trim() && a.postalCode?.trim());
}
