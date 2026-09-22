/**
 * Reduce a raw email body to just what this message says.
 *
 * Every reply carries the whole thread quoted beneath it, so storing the raw
 * body repeats each earlier message in every later one. This keeps the text
 * above the first quote marker, then removes mobile signatures, tracking-link
 * tails and legal footers. Pure, so it's unit-tested against real messages.
 */

/** True when `line` begins the quoted history — everything from here down is dropped. */
function startsQuotedHistory(line: string, next: string): boolean {
  const t = line.trim();
  const n = next.trim();
  if (/^_{10,}$/.test(t)) return true; // Outlook: a rule of underscores, then From:/Sent:
  if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(t)) return true;
  if (/^-{10,}$/.test(t) && /^\*?From:/i.test(n)) return true;
  if (/^\*?From:\*?\s/i.test(t) && /^\*?(Sent|Date):/i.test(n)) return true;
  if (/^On\s.+\bwrote:\s*$/i.test(t)) return true; // Gmail attribution, one line
  if (/^On\s.+\d/.test(t) && /^wrote:\s*$/i.test(n)) return true; // ...wrapped onto two
  if (t.startsWith(">")) return true;
  return false;
}

const MOBILE_SIGNATURE =
  /^(Get Outlook for (iOS|Android)|Sent from my (iPhone|iPad|Android|Samsung|Galaxy|Pixel)\b.*|Sent from Mail for Windows.*|Sent from Yahoo Mail.*|Sent via Superhuman.*)$/i;

const LEGAL_FOOTER =
  /^(CONFIDENTIALITY NOTICE|DISCLAIMER\b|This (e-?mail|message)( and any (files|attachments)[^.]*)? (is|are|may contain|contains) (confidential|privileged|intended))/i;

/**
 * Plain-text email is hard-wrapped at ~76 columns, which breaks sentences
 * mid-line. Rejoin a long line with the next when the next clearly continues
 * the sentence (starts lowercase). Short lines — addresses, sign-offs, list
 * items — are left alone.
 */
function unwrapHardBreaks(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && prev.trim().length >= 55 && !/[:;]$/.test(prev.trim()) && /^[a-z(]/.test(line.trim())) {
      out[out.length - 1] = `${prev.trimEnd()} ${line.trim()}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

export function cleanEmailBody(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");

  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (startsQuotedHistory(lines[i], lines[i + 1] ?? "")) break;
    // Strip link tails first so "Get Outlook for iOS<https://…>" is recognized.
    const line = lines[i].replace(/\s*<(https?:|mailto:)[^>\s]*>/gi, "");
    const t = line.trim();
    if (t === "--") break; // standard signature delimiter
    if (LEGAL_FOOTER.test(t)) break;
    if (MOBILE_SIGNATURE.test(t)) continue;
    kept.push(line);
  }

  const text = unwrapHardBreaks(kept)
    .join("\n")
    // Gmail wraps links in a redirect; show the real destination.
    .replace(/https?:\/\/www\.google\.com\/url\?q=([^&\s]+)[^\s]*/gi, (_m, q: string) => {
      try {
        return decodeURIComponent(q);
      } catch {
        return q;
      }
    })
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text ? text.slice(0, 4000) : null;
}

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

/**
 * HTML-only emails (common from phones and newsletters) → plain text that
 * cleanEmailBody can trim. Quoted history (Gmail's gmail_quote, <blockquote>)
 * is turned into "> " lines so the same cut applies. Deliberately simple: no
 * DOM, just the structure a message body needs to stay readable.
 */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1>/gi, "")
    // Everything from Gmail's quote wrapper or a blockquote down is history.
    .replace(/<div[^>]*class="?[^">]*gmail_quote[\s\S]*$/i, "\n> quoted\n")
    .replace(/<blockquote\b[\s\S]*$/i, "\n> quoted\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|tr|h[1-6]|table|ul|ol)>/gi, "\n")
    .replace(/<(p|div|tr|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, code: string) => {
    const key = code.toLowerCase();
    if (key.startsWith("#x")) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith("#") && key !== "#39") return String.fromCodePoint(parseInt(key.slice(1), 10));
    return ENTITIES[key] ?? m;
  });
  const text = s
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

/** "Name <a@b.com>, c@d.com" → "Name, c@d.com" (display name, else the address). */
export function displayNames(header: string | null | undefined): string {
  if (!header) return "";
  return header
    // Split on commas outside quotes: "Rahmati, Cameron" <c@x.com> is one person.
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((part) => {
      const m = part.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
      if (m) return m[1].trim() || m[2].trim();
      return part.trim();
    })
    .filter(Boolean)
    .join(", ");
}
