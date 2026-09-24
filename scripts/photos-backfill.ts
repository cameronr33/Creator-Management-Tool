/**
 * Fetch profile pictures (and followers, and a public email where none is
 * saved) for creators that have no picture yet.
 *
 *   npm run photos:backfill -- --dry-run   # lists who would be looked up; costs nothing
 *   npm run photos:backfill -- --apply     # looks them up (about $0.003 each)
 *
 * Only real Instagram handles are looked up; name-only creators are listed
 * as skipped.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "./db";
import { instagramHandles, refreshFromInstagram } from "../src/lib/instagram";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  if (!apply && !args.includes("--dry-run")) throw new Error("Pass --dry-run or --apply");

  const rows = await db
    .select({ id: schema.cmCreators.id, name: schema.cmCreators.name })
    .from(schema.cmCreators)
    .leftJoin(schema.cmCreatorPhotos, eq(schema.cmCreatorPhotos.creatorId, schema.cmCreators.id))
    .where(and(isNull(schema.cmCreatorPhotos.creatorId)));
  // Only a creator's own Instagram link counts (never a slug of their name).
  const handles = await instagramHandles(rows.map((r) => r.id));
  const lookable = rows.filter((r) => handles.get(r.id)).map((r) => ({ ...r, username: handles.get(r.id)! }));
  const skipped = rows.filter((r) => !handles.get(r.id));

  console.log(`${rows.length} creator(s) without a picture · ${lookable.length} with an Instagram handle · ${skipped.length} skipped\n`);
  for (const r of lookable) console.log(`  look up  @${r.username}  (${r.name})`);
  for (const r of skipped) console.log(`  skip     ${r.name} — no Instagram link saved`);
  if (!apply) {
    console.log(`\nDry run — nothing fetched. Estimated cost with --apply: about $${(lookable.length * 0.003).toFixed(2)}.`);
    return;
  }
  const r = await refreshFromInstagram(lookable.map((x) => x.id));
  console.log(`\nLooked up ${r.looked} · found ${r.found} · pictures saved ${r.photos} · public emails seen ${r.emailsFound}`);
  if (r.errors.length) console.log(`Problems:\n  ${r.errors.join("\n  ")}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
