/**
 * Verifies the manual add-creator feature.
 *
 *   npx tsx --env-file=.env.local scripts/verify-add-creator.ts
 *
 * Part 1 (pure) checks the link parser offline. Part 2 exercises
 * createCreatorWithPartnership against the database using a throwaway campaign,
 * then cleans up everything it created. Exit 0 = all assertions pass.
 */
import { and, eq, like } from "drizzle-orm";
import { db, schema } from "./db";
import { parseSocialUrl, deriveUsername, slugify } from "../src/lib/social-links";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const TEST_CAMPAIGN = "__verify_add_creator__";

async function main() {
  console.log("\n── Link parser ──");
  const cases: [string, string, string | null][] = [
    ["https://www.instagram.com/arctic.mojave", "instagram", "arctic.mojave"],
    ["instagram.com/mo_bronco/", "instagram", "mo_bronco"],
    ["@josh_deeeee", "instagram", "josh_deeeee"],
    ["https://www.tiktok.com/@hamdynamics", "tiktok", "hamdynamics"],
    ["https://www.youtube.com/@wewrench", "youtube", "wewrench"],
    ["https://www.facebook.com/hellausa", "facebook", "hellausa"],
    ["https://x.com/robinshute", "x", "robinshute"],
    ["https://myhellalights.com", "website", null],
  ];
  for (const [input, platform, handle] of cases) {
    const got = parseSocialUrl(input);
    check(
      `${input} → ${platform}${handle ? `/@${handle}` : ""}`,
      got?.platform === platform && got?.handle === handle,
      `got ${got?.platform}/${got?.handle}`,
    );
  }
  check("query params stripped", parseSocialUrl("https://www.instagram.com/foo?igsh=abc")?.handle === "foo");
  check("empty input → null", parseSocialUrl("") === null);

  console.log("\n── Username derivation ──");
  check(
    "prefers a handle over the name",
    deriveUsername([parseSocialUrl("https://www.instagram.com/realhandle")!], "Some Name") === "realhandle",
  );
  check(
    "falls back to a name slug when only a website is given",
    deriveUsername([parseSocialUrl("https://example.com")!], "Bob's Garage & Co") === "bobs-garage-co",
    slugify("Bob's Garage & Co"),
  );

  console.log("\n── createCreatorWithPartnership (live DB, cleaned up after) ──");
  const [client] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(eq(schema.clients.slug, "hella"))
    .limit(1);
  if (!client) {
    console.log("  [FAIL] HELLA client not found — cannot run DB checks");
    failures++;
    return;
  }

  const campaignId = await ensureCampaignByName(client.id, TEST_CAMPAIGN);

  // 1. Fresh creator from two links.
  const a = await createCreatorWithPartnership({
    clientId: client.id,
    name: "Verify Test Creator",
    links: ["https://www.instagram.com/__verify_test__", "https://www.facebook.com/verifytest"],
    campaignId,
    stage: "shortlisted",
  });
  check("creates a new creator", !a.reusedCreator && !a.reusedPartnership);
  check("username from the primary handle", a.username === "__verify_test__", a.username);

  const socials = await db
    .select()
    .from(schema.cmCreatorSocials)
    .where(eq(schema.cmCreatorSocials.creatorId, a.creatorId));
  check("stores both links", socials.length === 2, `got ${socials.length}`);
  check("exactly one primary", socials.filter((s) => s.isPrimary).length === 1);
  check(
    "primary is the first link (instagram)",
    socials.find((s) => s.isPrimary)?.platform === "instagram",
  );

  const [creatorRow] = await db
    .select()
    .from(schema.cmCreators)
    .where(eq(schema.cmCreators.id, a.creatorId))
    .limit(1);
  check(
    "mirrors the primary link onto the creator",
    creatorRow.profileUrl === "https://www.instagram.com/__verify_test__" &&
      creatorRow.platform === "instagram",
    `${creatorRow.profileUrl} / ${creatorRow.platform}`,
  );

  const transitions = await db
    .select()
    .from(schema.cmStageTransitions)
    .where(eq(schema.cmStageTransitions.partnershipId, a.partnershipId));
  check("records the opening stage transition", transitions.length === 1 && transitions[0].toStage === "shortlisted");

  // 2. Re-adding the same handle attaches instead of duplicating.
  const b = await createCreatorWithPartnership({
    clientId: client.id,
    name: "Verify Test Creator",
    links: ["https://www.instagram.com/__verify_test__"],
    campaignId,
  });
  check("re-adding reuses the creator", b.reusedCreator && b.creatorId === a.creatorId);
  check("re-adding reuses the partnership", b.reusedPartnership && b.partnershipId === a.partnershipId);

  // 3. Name-only add slugs a username.
  const c = await createCreatorWithPartnership({
    clientId: client.id,
    name: "Verify NoLink Shop",
    links: [],
    campaignId,
  });
  check("name-only add works", c.username === "verify-nolink-shop", c.username);

  // Cleanup — creators cascade to socials/partnerships/transitions.
  await db.delete(schema.cmCreators).where(eq(schema.cmCreators.id, a.creatorId));
  await db.delete(schema.cmCreators).where(eq(schema.cmCreators.id, c.creatorId));
  await db
    .delete(schema.cmCampaigns)
    .where(and(eq(schema.cmCampaigns.clientId, client.id), eq(schema.cmCampaigns.name, TEST_CAMPAIGN)));

  const leftovers = await db
    .select({ id: schema.cmCreators.id })
    .from(schema.cmCreators)
    .where(and(eq(schema.cmCreators.clientId, client.id), like(schema.cmCreators.username, "%verify%")));
  check("cleaned up after itself", leftovers.length === 0, `${leftovers.length} left`);
}

main()
  .then(() => {
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
