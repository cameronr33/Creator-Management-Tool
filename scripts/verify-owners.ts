/**
 * Verifies owners and the Mine / Everyone view (2026-09-28).
 *
 *   npm run preview:verify -- scripts/verify-owners.ts
 *
 * New deals start unassigned; Mine shows yours plus unassigned ones and says
 * how many of whose are hidden; assigning takes a real login only; Take it
 * never steals one someone owns; moving campaigns keeps the owner; a login
 * removed from the shared users table leaves the deal unassigned.
 */
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { chipLabels, hiddenSummary, inView, parseView, setOwner, splitByView, splitForList, takeUnassigned } from "../src/lib/owners";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";
import { moveToCampaign } from "../src/lib/campaigns";
import { getCreatorRows } from "../src/lib/queries";
import { getTodayData } from "../src/lib/today-data";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

function pure() {
  console.log("\n── Mine / Everyone (pure) ──");
  const me = "me";
  check("Everyone shows every deal", inView("someone", "all", me) && inView(null, "all", me) && inView(me, "all", me));
  check("Mine shows mine and unassigned — nothing falls through", inView(me, "mine", me) && inView(null, "mine", me));
  check("Mine hides a teammate's", !inView("kieran", "mine", me));
  check("no signed-in id: nothing is hidden", inView("kieran", "mine", null));
  check("an unknown cookie value means Everyone", parseView("mine") === "mine" && parseView("junk") === "all" && parseView(undefined) === "all");
  const split = splitByView(
    [
      { ownerId: me, ownerName: "Me Person" },
      { ownerId: null, ownerName: null },
      { ownerId: "k", ownerName: "Kieran Lee" },
      { ownerId: "k", ownerName: "Kieran Lee" },
    ],
    "mine",
    me,
  );
  check("split keeps the hidden ones", split.shown.length === 2 && split.hidden.length === 2);
  check("…and says whose they are", hiddenSummary(split.hidden) === "2 of Kieran's not shown" && hiddenSummary([]) === null);
  check("several owners are summed up", hiddenSummary([{ ownerName: "A One" }, { ownerName: "B Two" }, { ownerName: "C Three" }]) === "3 of teammates' not shown");
  // NEGATIVE (review, 2026-09-28): a search on Mine only looked through what Mine shows — "No creators match" when Kieran's did.
  const people = [
    { ownerId: me, ownerName: "Me Person", name: "Alice" },
    { ownerId: "k", ownerName: "Kieran Lee", name: "Bob" },
    { ownerId: "k", ownerName: "Kieran Lee", name: "Bobby" },
    { ownerId: null, ownerName: null, name: "Carl" },
  ];
  const bob = splitForList(people, "mine", me, (r) => r.name.toLowerCase().includes("bob"));
  check("a search on Mine looks through teammates' too, and says so", bob.rows.length === 0 && bob.total === 2 && hiddenSummary(bob.hidden, { matching: true }) === "2 of Kieran's also match");
  const plain = splitForList(people, "mine", me, null);
  check("…without a search it's the plain split", plain.rows.length === 2 && plain.total === 2 && hiddenSummary(plain.hidden) === "2 of Kieran's not shown");

  console.log("\n── Owner chips (pure) ──");
  const labels = chipLabels([
    { id: "1", name: "Cameron Rahmati" },
    { id: "2", name: "Kieran Keliher-Burke" },
    { id: "3", name: "Kara Kent" },
    { id: "4", name: "Sam" },
  ]);
  check("initials by default", labels.get("1") === "CR" && labels.get("4") === "SA");
  check("two people with the same initials are told apart", labels.get("2") === "KiK" && labels.get("3") === "KaK", JSON.stringify([...labels]));
}

async function live() {
  const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.slug, "hella")).limit(1);
  const [me] = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).limit(1);
  if (!me) return check("a login exists to assign to", false);
  const NONE = "00000000-0000-0000-0000-000000000000";
  let campaignA = NONE;
  let campaignB = NONE;
  const creatorIds: string[] = [];
  let tempUserId: string | null = null;
  const add = async (h: string, campaignId: string) => {
    const r = await createCreatorWithPartnership({ clientId: client.id, name: h, links: [`https://www.instagram.com/${h}`], campaignId, userId: me.id });
    creatorIds.push(r.creatorId);
    return r.partnershipId;
  };
  const ownerOf = async (id: string) => (await db.select({ o: schema.cmPartnerships.ownerId }).from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, id)))[0]?.o ?? null;
  try {
    campaignA = await ensureCampaignByName(client.id, "__verify_owners_a__");
    campaignB = await ensureCampaignByName(client.id, "__verify_owners_b__");
    const a = await add("__verify_ow_a", campaignA);
    const b = await add("__verify_ow_b", campaignA);
    console.log("\n── Assigning ──");
    check("a new deal starts unassigned, even when someone added it", (await ownerOf(a)) === null);
    const [{ updatedAt: before }] = await db.select({ updatedAt: schema.cmPartnerships.updatedAt }).from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, a));
    const set = await setOwner([a], me.id);
    const [{ updatedAt: after }] = await db.select({ updatedAt: schema.cmPartnerships.updatedAt }).from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, a));
    check("assigning a teammate sets the owner", set.ok && (await ownerOf(a)) === me.id);
    check("…without touching updatedAt (the email check files mail by it)", before.getTime() === after.getTime());
    const rows = await getCreatorRows(client.id, { campaignId: campaignA, withOutreach: false });
    check("rows carry the owner's name", rows.find((r) => r.partnershipId === a)?.ownerName === me.name && rows.find((r) => r.partnershipId === b)?.ownerId === null);
    const bogus = await setOwner([b], "11111111-1111-4111-8111-111111111111");
    check("an id that isn't a login is refused, and nothing changes", !bogus.ok && (await ownerOf(b)) === null);
    const cleared = await setOwner([a], null);
    check("assigning to nobody clears it", cleared.ok && (await ownerOf(a)) === null);

    console.log("\n── Take it ──");
    await setOwner([a], me.id);
    const took = await takeUnassigned([a, b], me.id);
    check("Take it claims only the unassigned one", took.taken === 1 && took.alreadyOwned === 1 && (await ownerOf(b)) === me.id);

    console.log("\n── The owner stays with the deal ──");
    const moved = await moveToCampaign([a], campaignB);
    check("moving to another campaign keeps the owner", (moved.moved ?? 0) === 1 && (await ownerOf(a)) === me.id);

    console.log("\n── Today on Mine ──");
    const c = await add("__verify_ow_c", campaignA);
    // The preview has one login: stand a throwaway one in as "a teammate" — preview only, never the shared production table.
    if (process.env.CREATOR_LOCAL_PREVIEW === "1") {
      const [temp] = await db
        .insert(schema.users)
        .values({ name: "__verify Teammate", email: `__verify_owner_${Date.now()}@example.test`, passwordHash: "x", role: "member" })
        .returning({ id: schema.users.id });
      tempUserId = temp.id;
      await setOwner([c], tempUserId);
      // NEGATIVE (review, 2026-09-28): their Posted and closed deals were counted as "not shown" though Today never lists them.
      const posted = await add("__verify_ow_posted", campaignA);
      const closed = await add("__verify_ow_closed", campaignA);
      await db.insert(schema.cmDeliverables).values({ partnershipId: posted, url: "https://www.instagram.com/reel/__verify_ow/" });
      await db.update(schema.cmPartnerships).set({ stage: "posted" }).where(eq(schema.cmPartnerships.id, posted));
      await db.update(schema.cmPartnerships).set({ stage: "declined" }).where(eq(schema.cmPartnerships.id, closed));
      await setOwner([posted, closed], tempUserId);
      const mine = await getTodayData({ clientId: client.id, campaignId: campaignA, view: "mine", userId: me.id });
      const everyone = await getTodayData({ clientId: client.id, campaignId: campaignA, view: "all", userId: me.id });
      check("Mine leaves out a teammate's deal and says so", !mine.rows.some((r) => r.partnershipId === c) && mine.hiddenSummary === "1 of __verify's not shown", mine.hiddenSummary ?? "none");
      check("…counting only what Today would have listed (not their Posted or closed deals)", mine.hiddenSummary === "1 of __verify's not shown");
      check("…and counts only what it shows", Object.values(mine.stageCounts).reduce((s, n) => s + (n ?? 0), 0) === Object.values(everyone.stageCounts).reduce((s, n) => s + (n ?? 0), 0) - 3);
      check("Everyone shows it", everyone.rows.some((r) => r.partnershipId === c) && everyone.hiddenSummary === null);
      await db.delete(schema.users).where(eq(schema.users.id, tempUserId));
      tempUserId = null;
      check("a login removed from the shared table leaves the deal unassigned", (await ownerOf(c)) === null);
    }
  } finally {
    if (tempUserId) await db.delete(schema.users).where(eq(schema.users.id, tempUserId));
    if (creatorIds.length) await db.delete(schema.cmCreators).where(inArray(schema.cmCreators.id, creatorIds));
    await db.delete(schema.cmCampaigns).where(inArray(schema.cmCampaigns.id, [campaignA, campaignB]));
  }
  check("test rows cleaned up", (await db.select().from(schema.cmCampaigns).where(inArray(schema.cmCampaigns.id, [campaignA, campaignB]))).length === 0);
}

async function main() {
  pure();
  await live();
}

main().then(
  () => {
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
