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

  console.log("\n── primitives exist ──");
  const ui = readFileSync(join(ROOT, "components", "ui.tsx"), "utf8");
  for (const name of ["Button", "IconButton", "Input", "Select", "Textarea", "Field", "Callout", "Badge", "StagePill", "PageHeader", "Card", "CardHeader", "EmptyState", "Segmented", "Checkbox"]) {
    check(`ui.tsx exports ${name}`, new RegExp(`export function ${name}\\b`).test(ui));
  }
  const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
  for (const token of ["--accent", "--accent-hover", "--good", "--warn", "--bad", "--info", "--sidebar-bg", "--brand-lime", "--text-faint"]) {
    check(`globals.css defines ${token}`, new RegExp(`${token}:`).test(css));
  }
}

main();
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
