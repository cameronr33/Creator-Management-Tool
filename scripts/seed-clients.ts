/**
 * Idempotent client roster maintenance for Creator Manager.
 *
 *   npx tsx --env-file=.env.local scripts/seed-clients.ts \
 *     --ensure "Imperial:imperial" "Winston:winston" \
 *     --hide default meyle \
 *     --show hella imperial
 *
 * --ensure  "Name:slug" pairs — inserts the client into the SHARED sa_clients
 *           roster if the slug doesn't exist (never renames an existing one).
 * --hide    slugs to hide from Creator Manager only (cm_client_settings.hidden).
 *           The shared row is untouched — the analytics dashboard still sees it.
 * --show    slugs to un-hide.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "./db";

function parseArgs(argv: string[]) {
  const out: { ensure: string[]; hide: string[]; show: string[] } = { ensure: [], hide: [], show: [] };
  let bucket: keyof typeof out | null = null;
  for (const a of argv) {
    if (a === "--ensure") bucket = "ensure";
    else if (a === "--hide") bucket = "hide";
    else if (a === "--show") bucket = "show";
    else if (bucket) out[bucket].push(a);
  }
  return out;
}

async function setHidden(slug: string, hidden: boolean) {
  const [client] = await db
    .select({ id: schema.clients.id, name: schema.clients.name })
    .from(schema.clients)
    .where(eq(schema.clients.slug, slug))
    .limit(1);
  if (!client) {
    console.log(`  [skip] no client with slug "${slug}"`);
    return;
  }
  await db
    .insert(schema.cmClientSettings)
    .values({ clientId: client.id, hidden })
    .onConflictDoUpdate({
      target: schema.cmClientSettings.clientId,
      set: { hidden, updatedAt: new Date() },
    });
  console.log(`  [${hidden ? "hide" : "show"}] ${client.name} (${slug})`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.ensure.length) console.log("Ensuring clients exist:");
  for (const pair of args.ensure) {
    const idx = pair.lastIndexOf(":");
    if (idx < 1) {
      console.log(`  [skip] "${pair}" is not Name:slug`);
      continue;
    }
    const name = pair.slice(0, idx).trim();
    const slug = pair.slice(idx + 1).trim().toLowerCase();
    const [existing] = await db
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .where(eq(schema.clients.slug, slug))
      .limit(1);
    if (existing) {
      console.log(`  [exists] ${existing.name} (${slug})`);
      continue;
    }
    await db.insert(schema.clients).values({ name, slug, isActive: true });
    console.log(`  [created] ${name} (${slug})`);
  }

  if (args.hide.length) console.log("Hiding from Creator Manager:");
  for (const slug of args.hide) await setHidden(slug, true);
  if (args.show.length) console.log("Showing in Creator Manager:");
  for (const slug of args.show) await setHidden(slug, false);

  console.log("\nRoster as Creator Manager sees it:");
  const rows = await db
    .select({
      name: schema.clients.name,
      slug: schema.clients.slug,
      isActive: schema.clients.isActive,
      hidden: schema.cmClientSettings.hidden,
    })
    .from(schema.clients)
    .leftJoin(schema.cmClientSettings, eq(schema.cmClientSettings.clientId, schema.clients.id))
    .orderBy(schema.clients.name);
  for (const r of rows) {
    const state = !r.isActive ? "inactive" : r.hidden ? "hidden" : "visible";
    console.log(`  ${state.padEnd(8)} ${r.name} (${r.slug})`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
