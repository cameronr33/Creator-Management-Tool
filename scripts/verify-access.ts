/**
 * Verifies who may call what (2026-09-24: clients get their own logins).
 *
 *   npm run preview:verify -- scripts/verify-access.ts
 *
 * Static, over the source tree: every API route handler states its guard —
 * the agency's (requireAgency), the portal's (requireClientUser, only under
 * /api/client/), or the cron secret — and every agency server action refuses
 * a client login. Portal routes never read the agency's client cookie: their
 * brand comes from the login alone. Pure — no database.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { isClientSession } from "../src/lib/api-helpers";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const SRC = join(__dirname, "..", "src");
const API = join(SRC, "app", "api");

function routes(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) routes(p, out);
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

/** Each exported handler's source, by method. */
function handlers(src: string): { method: string; body: string }[] {
  const re = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
  const starts = [...src.matchAll(re)].map((m) => ({ method: m[1], at: m.index! }));
  return starts.map((s, i) => ({ method: s.method, body: src.slice(s.at, starts[i + 1]?.at ?? src.length) }));
}

const COOKIE_SCOPED = /getSelectedClientSlug|resolveClient\(|InSelectedClient|getSelectedCampaignId|resolveCampaign\(|getSelectedView/;

/** Source without comments, so a cookies() mentioned in prose doesn't count as a read. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Exported functions whose body reads a cookie — each must be a known scope
 * getter. Any declaration style counts (review, 2026-09-28): `export async
 * function`, `export function`, and `export const x = cache(async () => …)`.
 */
function cookieGetters(src: string): string[] {
  const text = code(src);
  const starts = [...text.matchAll(/export\s+(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=)/g)].map((m) => ({ name: m[1] ?? m[2], at: m.index! }));
  return starts
    .filter((s, i) => /\bcookies\(\)/.test(text.slice(s.at, starts[i + 1]?.at ?? text.length)) && !/^set/.test(s.name))
    .map((s) => s.name);
}

/** The only modules that may read a cookie at all — anything new must be looked at and added here and to COOKIE_SCOPED. */
const COOKIE_MODULES = new Set(["lib/campaigns.ts", "lib/client-cookie.ts", "lib/view-cookie.ts"]);

/** Every .ts/.tsx file under a folder. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Files (paths relative to src) that call cookies() and aren't one of the cookie modules. */
function strayCookieReaders(files: { rel: string; src: string }[]): string[] {
  return files.filter((f) => /\bcookies\(\)/.test(code(f.src)) && !COOKIE_MODULES.has(f.rel)).map((f) => f.rel);
}

function main() {
  console.log("\n── Every API route states who may call it ──");
  const files = routes(API);
  const unguarded: string[] = [];
  const portalWrong: string[] = [];
  const agencyUsesPortal: string[] = [];
  let portalRoutes = 0;
  let seen = 0;
  for (const file of files) {
    const rel = relative(API, file).split(sep).join("/");
    if (rel.startsWith("auth/")) continue; // NextAuth's own sign-in endpoints
    const src = readFileSync(file, "utf8");
    const portal = rel.startsWith("client/");
    if (portal) portalRoutes++;
    for (const h of handlers(src)) {
      seen++;
      const agency = /requireAgency\(/.test(h.body);
      const client = /requireClientUser\(/.test(h.body);
      const cron = /requireCronSecret\(/.test(h.body);
      // The photo route serves both: a client login is checked against its own brand first.
      const photoBoth = rel === "creators/[id]/photo/route.ts" && agency && /isClientSession\(/.test(h.body);
      // The one public route: its guard is the one-time invite token, and it may do nothing but accept one.
      const invite = rel === "invite/route.ts" && /acceptInvite\(/.test(h.body) && !/\bdb\b|InSelectedClient|getSelectedClientSlug/.test(h.body);
      if (!agency && !client && !cron && !invite) unguarded.push(`${rel} ${h.method}`);
      if (portal && (!client || agency || COOKIE_SCOPED.test(h.body))) portalWrong.push(`${rel} ${h.method}`);
      if (!portal && client && !photoBoth) agencyUsesPortal.push(`${rel} ${h.method}`);
    }
  }
  // A checker that finds nothing passes everything: prove it read the handlers.
  check(`the handlers were actually found (${seen} in ${files.length} files)`, seen >= files.length - 1);
  check(`every handler in ${files.length} route files calls a guard`, unguarded.length === 0, unguarded.join(", "));
  const probe = handlers("export async function GET() { return 1 }\nexport async function POST() { await requireAgency(); }");
  check("the checker catches a handler without a guard", probe.length === 2 && !/requireAgency\(/.test(probe[0].body) && /requireAgency\(/.test(probe[1].body));
  check(`portal routes (${portalRoutes}) use only the portal guard, and never the agency's client cookie`, portalWrong.length === 0, portalWrong.join(", "));
  check("no agency route accepts a portal login", agencyUsesPortal.length === 0, agencyUsesPortal.join(", "));

  console.log("\n── Server actions ──");
  const actions = readFileSync(join(SRC, "app", "actions.ts"), "utf8");
  const exported = [...actions.matchAll(/export\s+async\s+function\s+(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g)];
  const loose = exported.filter(([, name, body]) => name !== "signOutAction" && !/await agencyOnly\(\)/.test(body)).map(([, n]) => n);
  check(`every agency action (${exported.length - 1}) refuses a client login`, exported.length > 1 && loose.length === 0, loose.join(", "));

  console.log("\n── The guards themselves ──");
  const helpers = readFileSync(join(SRC, "lib", "api-helpers.ts"), "utf8");
  const clientGuard = helpers.slice(helpers.indexOf("export async function requireClientUser"), helpers.indexOf("\n}\n", helpers.indexOf("export async function requireClientUser")));
  check("the portal guard takes the brand from the login only (no cookie, no request)", clientGuard.length > 0 && !COOKIE_SCOPED.test(clientGuard) && !/cookies\(|req\b|request\b/.test(clientGuard));
  check("a client login is recognised as one", isClientSession({ user: { kind: "client" } }) && !isClientSession({ user: { kind: "agency" } }) && !isClientSession({ user: {} }));
  const layout = readFileSync(join(SRC, "app", "(app)", "layout.tsx"), "utf8");
  check("the agency's pages send a client login to the portal", /kind === "client"\) redirect\("\/portal"\)/.test(layout));

  console.log("\n── Pages check for themselves (a layout alone can be skipped) ──");
  // Security review (2026-09-24): Next can render a page without re-running its layout.
  const pagesUnder = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) pagesUnder(p, out);
      else if (name === "page.tsx") out.push(p);
    }
    return out;
  };
  const agencyPages = pagesUnder(join(SRC, "app", "(app)"));
  const agencyLoose = agencyPages.filter((p) => !/await requireAgencyPage\(\)/.test(readFileSync(p, "utf8"))).map((p) => relative(SRC, p));
  check(`every agency page (${agencyPages.length}) calls requireAgencyPage() itself`, agencyPages.length >= 8 && agencyLoose.length === 0, agencyLoose.join(", "));
  const portalPages = pagesUnder(join(SRC, "app", "portal"));
  const portalLoose = portalPages.filter((p) => !/await getPortalContext\(\)/.test(readFileSync(p, "utf8"))).map((p) => relative(SRC, p));
  check(`every portal page (${portalPages.length}) resolves its brand from the login itself`, portalPages.length >= 4 && portalLoose.length === 0, portalLoose.join(", "));
  const guard = readFileSync(join(SRC, "lib", "page-guards.ts"), "utf8");
  check("the page guard refuses signed-out and client logins", /if \(!session\?\.user\) redirect\("\/login"\)/.test(guard) && /kind === "client"\) redirect\("\/portal"\)/.test(guard));

  console.log("\n── Every cookie scope is known to the portal check (2026-09-28) ──");
  const libFiles = readdirSync(join(SRC, "lib")).filter((f) => f.endsWith(".ts"));
  const unknownGetters = libFiles.flatMap((f) => cookieGetters(readFileSync(join(SRC, "lib", f), "utf8")).filter((n) => !COOKIE_SCOPED.test(n)).map((n) => `${f}: ${n}`));
  check("every cookie getter in src/lib is in the scope pattern the portal routes are checked against", unknownGetters.length === 0, unknownGetters.join(", "));
  const probeGetters = cookieGetters("export async function getSecretScope() {\n  return (await cookies()).get(\"x\");\n}");
  check("…and that check catches a new one", probeGetters.length === 1 && !COOKIE_SCOPED.test(probeGetters[0]));
  check("the Mine / Everyone view cookie is one of them", cookieGetters(readFileSync(join(SRC, "lib", "view-cookie.ts"), "utf8")).includes("getSelectedView"));
  const cachedProbe = cookieGetters("export const getOwnerFilter = cache(async () => {\n  return (await cookies()).get(\"x\");\n});\nexport function other() { return 1; }");
  check("…a getter written as `export const x = cache(async …)` is seen too", cachedProbe.length === 1 && cachedProbe[0] === "getOwnerFilter");
  // Second review (2026-09-28): over all of src — app routes, pages, .tsx and lib subfolders — not just src/lib/*.ts.
  const everyFile = sourceFiles(SRC).map((p) => ({ rel: relative(SRC, p).split(sep).join("/"), src: readFileSync(p, "utf8") }));
  const strays = strayCookieReaders(everyFile);
  check(`only the known cookie modules in all of src (${everyFile.length} files) read cookies`, strays.length === 0 && everyFile.some((f) => COOKIE_MODULES.has(f.rel)), strays.join(", "));
  check(
    "…and that check catches a route or page reading one itself",
    strayCookieReaders([{ rel: "app/api/client/x/route.ts", src: "export async function POST() { const c = await cookies(); }" }, { rel: "app/(app)/page.tsx", src: "const v = (await cookies()).get('x');" }]).length === 2,
  );
  check("…and a cookie mentioned only in a comment doesn't count", !/\bcookies\(\)/.test(code("/** rejects later cookies() calls */\n// cookies() here too\nexport const a = 1;")));

  console.log("\n── A client login is re-checked every time ──");
  const clientPaths = [join(SRC, "lib", "api-helpers.ts"), join(SRC, "lib", "portal-data.ts"), join(SRC, "app", "api", "creators", "[id]", "photo", "route.ts")];
  const trusting = clientPaths.filter((p) => !/activeClientPerson\(/.test(readFileSync(p, "utf8"))).map((p) => relative(SRC, p));
  check("the portal guard, the portal's data and the photo route check the login against the database", trusting.length === 0, trusting.join(", "));
  const emailCheck = readFileSync(join(SRC, "lib", "page-email-check.ts"), "utf8");
  check("a client login never starts a check of the agency's mailbox", /kind !== "client"/.test(emailCheck));
}

main();
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
