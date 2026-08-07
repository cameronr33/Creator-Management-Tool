/**
 * Minimal RFC-4180 CSV reader/writer.
 *
 * Written by hand rather than pulled from npm because the HELLA exports have
 * two awkward properties: the outreach message template lives in a quoted
 * field containing embedded newlines and doubled quotes, and the real header
 * row is the 12th line rather than the first.
 */

export type CsvRow = Record<string, string>;

/** Splits raw CSV text into a matrix of strings. */
export function parseCsvMatrix(text: string): string[][] {
  // Strip a UTF-8 BOM if the sheet export left one behind.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      // Swallow; the \n that follows ends the record.
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  // Trailing record with no newline terminator.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Finds the header row by looking for the first row containing every marker,
 * then returns the remaining rows as objects keyed by that header.
 *
 * Duplicate column names (the HELLA tracker has two "Notes" columns) are
 * suffixed positionally: "Notes", "Notes__2".
 */
export function parseCsvWithHeaderAt(
  text: string,
  markers: string[],
): { header: string[]; rows: CsvRow[]; headerIndex: number } {
  const matrix = parseCsvMatrix(text);

  const headerIndex = matrix.findIndex((row) => {
    const cells = row.map((c) => c.trim().toLowerCase());
    return markers.every((m) => cells.includes(m.toLowerCase()));
  });

  if (headerIndex === -1) {
    throw new Error(
      `Could not locate a header row containing: ${markers.join(", ")}`,
    );
  }

  const seen = new Map<string, number>();
  const header = matrix[headerIndex].map((raw) => {
    const name = raw.trim();
    // Empty column headers (the HELLA tracker has spacer columns) are dropped,
    // never deduped into a "__2" key.
    if (name === "") return "";
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name}__${count}`;
  });

  const rows: CsvRow[] = [];
  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const cells = matrix[i];
    // Skip rows that are entirely empty.
    if (cells.every((c) => c.trim() === "")) continue;
    const obj: CsvRow = {};
    header.forEach((key, idx) => {
      if (key === "") return;
      obj[key] = (cells[idx] ?? "").trim();
    });
    rows.push(obj);
  }

  return { header, rows, headerIndex };
}

// ─── Value coercion ──────────────────────────────────────────────

/** "50,443" -> 50443; "" -> null. */
export function toInt(value: string | undefined | null): number | null {
  if (value == null) return null;
  const cleaned = value.replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** "0.51" -> 0.51; "" -> null. */
export function toFloat(value: string | undefined | null): number | null {
  if (value == null) return null;
  const cleaned = value.replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses the compact view counts the grid scrape produces:
 * "11.9M" -> 11900000, "324K" -> 324000, "1,204" -> 1204.
 */
export function toViewCount(value: string | undefined | null): number | null {
  if (value == null) return null;
  const raw = value.trim();
  if (raw === "") return null;

  const match = raw.match(/^([\d.,]+)\s*([KMB])?$/i);
  if (!match) return toInt(raw);

  const n = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;

  const suffix = match[2]?.toUpperCase();
  const multiplier = suffix === "B" ? 1e9 : suffix === "M" ? 1e6 : suffix === "K" ? 1e3 : 1;
  return Math.round(n * multiplier);
}

/** Sheet booleans are the strings "TRUE"/"FALSE". */
export function toBool(value: string | undefined | null): boolean {
  return (value ?? "").trim().toUpperCase() === "TRUE";
}

/** "2025-04-11 to 2026-05-12" -> ["2025-04-11", "2026-05-12"]. */
export function parseDateRange(
  value: string | undefined | null,
): { start: string | null; end: string | null } {
  const raw = (value ?? "").trim();
  if (!raw) return { start: null, end: null };
  const parts = raw.split(/\s+to\s+/i);
  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
  return {
    start: parts[0] && isDate(parts[0]) ? parts[0].trim() : null,
    end: parts[1] && isDate(parts[1]) ? parts[1].trim() : null,
  };
}

/** Pulls the shortcode out of an instagram.com/p/<code>/ or /reel/<code>/ URL. */
export function instagramShortcode(url: string | undefined | null): string | null {
  if (!url) return null;
  const match = url.match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

/** Normalises a handle or profile URL to https://www.instagram.com/<username>. */
export function normalizeInstagramUrl(input: string): string {
  const username = normalizeUsername(input);
  return `https://www.instagram.com/${username}`;
}

export function normalizeUsername(input: string): string {
  const raw = input.trim();
  const fromUrl = raw.match(/instagram\.com\/([A-Za-z0-9._]+)/);
  const username = fromUrl ? fromUrl[1] : raw.replace(/^@/, "");
  return username.replace(/\/+$/, "").toLowerCase();
}

// ─── Writing ─────────────────────────────────────────────────────

export function toCsv(rows: CsvRow[], header?: string[]): string {
  const cols = header ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const escape = (v: string) =>
    /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const lines = [cols.join(",")];
  for (const row of rows) {
    lines.push(cols.map((c) => escape(row[c] ?? "")).join(","));
  }
  return lines.join("\n");
}
