/**
 * Verifies the design system is actually used.
 *
 *   npm run verify:design
 *
 * The brand tokens live in globals.css and the primitives in ui.tsx. Drift
 * happens one "quick" raw Tailwind colour at a time, so this is the frozen
 * rule: outside the two files that define the tokens, no source file may use
 * a raw palette class, and no meaning-carrying text may be smaller than 11px.
 * Pure — reads the source tree, no database.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "src");
const ALLOWED = new Set(["components/ui.tsx", "lib/stages.ts"].map((p) => p.replace(/\//g, "\\")));

const RAW_PALETTE =
  /\b(?:hover:|focus:|active:|group-hover:)?(?:bg|text|ring|border|fill|stroke|from|to|via|outline|divide|placeholder|accent)-(?:amber|red|emerald|indigo|slate|gray|zinc|neutral|stone|blue|green|yellow|orange|rose|sky|violet|purple|teal|lime|pink|fuchsia|cyan)-\d{2,3}\b/g;
const TINY_TEXT = /\btext-\[(?:[0-9](?:\.\d+)?|10)px\]/g;
const HARDCODED_HEX = /#(?:[0-9a-fA-F]{3}){1,2}\b/g;

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

function main() {
  const files = walk(ROOT);
  const rawHits: string[] = [];
  const tinyHits: string[] = [];
  const hexHits: string[] = [];

  for (const file of files) {
    const rel = relative(ROOT, file);
    const src = readFileSync(file, "utf8");
    if (!ALLOWED.has(rel) && !rel.endsWith(".css")) {
      for (const m of src.match(RAW_PALETTE) ?? []) rawHits.push(`${rel}: ${m}`);
      for (const m of src.match(TINY_TEXT) ?? []) tinyHits.push(`${rel}: ${m}`);
    }
    // Colours belong in globals.css (tokens) or the brand mark's SVG — nowhere else.
    if (!rel.endsWith(".css") && !rel.endsWith("brand.tsx") && !rel.endsWith("icon.svg")) {
      for (const m of src.match(HARDCODED_HEX) ?? []) {
        // Ignore hex inside comments/docs like "#8BC1E3 (sky)" only when in a comment line.
        const line = src.split("\n").find((l) => l.includes(m)) ?? "";
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        hexHits.push(`${rel}: ${m}`);
      }
    }
  }

  console.log(`\n── design tokens (${files.length} source files) ──`);
  check("no raw Tailwind palette classes outside ui.tsx / stages.ts", rawHits.length === 0, rawHits.slice(0, 8).join("; "));
  check("no text smaller than 11px", tinyHits.length === 0, tinyHits.slice(0, 8).join("; "));
  check("no hard-coded hex colours outside globals.css and the brand mark", hexHits.length === 0, hexHits.slice(0, 8).join("; "));

  // Regression (2026-09-24): sidebar dropdown options set dark text on a list the
  // browser painted dark — unreadable. Options take their colours from globals.css.
  const optionColour: string[] = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel.endsWith(".css")) continue;
    for (const m of readFileSync(file, "utf8").match(/<option[^>]*className=/g) ?? []) optionColour.push(`${rel}: ${m}`);
  }
  check("no <option> sets its own colours (globals.css styles every dropdown list)", optionColour.length === 0, optionColour.slice(0, 5).join("; "));
  const cssAll = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
  check(
    "dropdown lists have explicit colours, and the sidebar's are dark",
    /select option\s*\{[^}]*background-color[^}]*color/.test(cssAll) && /\.select-chevron-light option\s*\{[^}]*background-color/.test(cssAll),
  );

  // Regression (review, 2026-09-28): Field renders a <label>, which hands its clicks to the first button inside —
  // clicking "When" pressed "Today". A row of buttons goes in FieldGroup, never in Field.
  const segmentedInLabel: string[] = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (!rel.endsWith(".tsx")) continue;
    for (const m of readFileSync(file, "utf8").match(/<Field\b[^>]*>\s*<Segmented\b/g) ?? []) segmentedInLabel.push(`${rel}: ${m.replace(/\s+/g, " ").slice(0, 60)}`);
  }
  check("no Segmented inside a Field (a <label> would press its first button) — use FieldGroup", segmentedInLabel.length === 0, segmentedInLabel.slice(0, 5).join("; "));

  console.log("\n── primitives exist ──");
  const ui = readFileSync(join(ROOT, "components", "ui.tsx"), "utf8");
  for (const name of ["Button", "IconButton", "Input", "Select", "Textarea", "Field", "Callout", "Badge", "StagePill", "PageHeader", "Card", "CardHeader", "EmptyState", "Segmented", "Checkbox", "FieldGroup", "OwnerChip", "ChipButton", "TurnDot"]) {
    check(`ui.tsx exports ${name}`, new RegExp(`export function ${name}\\b`).test(ui));
  }
  // The pop-up menu needs state and a portal, so it lives in its own client file (2026-09-29).
  const menu = readFileSync(join(ROOT, "components", "menu.tsx"), "utf8");
  for (const name of ["Menu", "MenuItem", "MenuLabel"]) {
    check(`menu.tsx exports ${name}`, new RegExp(`export function ${name}\\b`).test(menu));
  }
  check("the menu renders outside clipping cards (a portal to document.body)", /createPortal\(/.test(menu) && /document\.body/.test(menu));
  // Review 2026-09-29: the panel sits at the end of the page, so Tab would leave it open behind you.
  check("Tab closes the menu and hands focus back to its button", /e\.key === "Tab"/.test(menu));
  check("the current choice is told to screen readers in words (aria-current isn't for menu items)", !/aria-current/.test(menu) && /SrOnly/.test(menu));
  const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
  for (const token of ["--accent", "--accent-hover", "--good", "--warn", "--bad", "--info", "--sidebar-bg", "--brand-lime", "--text-faint"]) {
    check(`globals.css defines ${token}`, new RegExp(`${token}:`).test(css));
  }

  // Design review 2026-09-30 (owner: all shadow, interaction and design picks).
  console.log("\n── elevation, motion and contrast ──");
  const shadowHits: string[] = [];
  const vendorHits: string[] = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel.endsWith(".css")) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.match(/\bshadow-(?:sm|md|lg|xl|2xl|inner|pop)\b|\bshadow-\[/g) ?? []) shadowHits.push(`${rel}: ${m}`);
    // Words people read: string literals and JSX text. Identifiers and API paths don't count.
    for (const line of src.split("\n")) {
      if (/^\s*(\/\/|\*|\/\*|import\b)/.test(line)) continue;
      for (const m of line.match(/"[^"]*\bGmail\b[^"]*"|`[^`]*\bGmail\b[^`]*`|>[^<>{}]*\bGmail\b[^<>{}]*</g) ?? []) vendorHits.push(`${rel}: ${m.slice(0, 60)}`);
      if (rel.endsWith(".tsx") && /^\s*[^<>{}=;()"'`/*]*\bGmail\b[^<>{}=;()"'`]*$/.test(line)) vendorHits.push(`${rel}: ${line.trim().slice(0, 60)}`);
    }
  }
  check("shadows come only from the three elevation tokens (shadow-control / shadow-card / shadow-float)", shadowHits.length === 0, shadowHits.slice(0, 6).join("; "));
  for (const t of ["--shadow-control", "--shadow-card", "--shadow-float"]) check(`globals.css defines ${t}`, new RegExp(`${t}:`).test(css));
  check("no vendor name in words people read (say mailbox or email; the connect button may say Google)", vendorHits.length === 0, vendorHits.slice(0, 5).join("; "));
  for (const t of ["--duration-quick", "--duration-normal", "--duration-gentle", "--ease-out"]) check(`globals.css defines the motion setting ${t}`, new RegExp(`${t}:`).test(css));
  check("motion switches off when the computer asks for reduced motion", /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css));
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const tokenHex = (name: string) => css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1] ?? null;
  const field = tokenHex("--border-field"), surface = tokenHex("--surface");
  check("field edges clear 3:1 against the card (WCAG 1.4.11)", !!field && !!surface && ratio(field, surface) >= 3, field && surface ? ratio(field, surface).toFixed(2) : "no --border-field token");
  check("inputs, dropdowns and text areas are drawn with the field-edge colour", /const FIELD_BASE =[^;]*\bborder-field\b/.test(ui));
  check("page titles are 20px (text-xl), a clear step above names", /<h1 className="text-xl font-semibold/.test(ui));
  check("card titles read as headings: 15px in the main text colour, not small grey capitals", /export function SectionTitle[\s\S]{0,200}text-\[15px\][^"]*text-text\b/.test(ui) && !/export function SectionTitle[\s\S]{0,200}uppercase/.test(ui));
  const toastSrc = readFileSync(join(ROOT, "components", "toast.tsx"), "utf8");
  check("the success tick clears 3:1 (the dark green, not lime)", /good: <CheckCircle2[^>]*text-good"/.test(toastSrc));
  const owner = readFileSync(join(ROOT, "components", "owner-controls.tsx"), "utf8");
  check("the owner chip has a click area of at least 24px (WCAG 2.2 target size)", /triggerClassName="[^"]*before:-inset-1/.test(owner));
}

main();
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
