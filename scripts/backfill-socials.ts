/**
 * Backfill cm_creator_socials for creators that predate the table (the original
 * HELLA import) by deriving a primary link from their denormalized profileUrl.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-socials.ts
 *
 * Idempotent — creators that already have a link row are skipped, and the
 * insert is guarded by the (creatorId, url) unique constraint.
 */
import { eq, isNull } from "drizzle-orm";
import { db, schema } from "./db";
import { parseSocialUrl } from "../src/lib/social-links";

async function main() {
  const creators = await db
    .select({
      id: schema.cmCreators.id,
      username: schema.cmCreators.username,
      profileUrl: schema.cmCreators.profileUrl,
      platform: schema.cmCreators.platform,
      socialId: schema.cmCreatorSocials.id,
    })
    .from(schema.cmCreators)
    .leftJoin(schema.cmCreatorSocials, eq(schema.cmCreatorSocials.creatorId, schema.cmCreators.id))
    .where(isNull(schema.cmCreatorSocials.id));

  if (creators.length === 0) {
    console.log("Nothing to backfill — every creator already has at least one link.");
    return;
  }

  let inserted = 0;
  for (const c of creators) {
    const parsed = parseSocialUrl(c.profileUrl);
    await db
      .insert(schema.cmCreatorSocials)
      .values({
        creatorId: c.id,
        platform: parsed?.platform ?? c.platform,
        url: parsed?.url ?? c.profileUrl,
        handle: parsed?.handle ?? c.username,
        isPrimary: true,
      })
      .onConflictDoNothing();
    inserted++;
  }

  console.log(`Backfilled ${inserted} primary link(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
