/**
 * Verifies owners and the Mine / Everyone view (2026-09-28).
 *
 *   npm run preview:verify -- scripts/verify-owners.ts
 *
 * New deals start unassigned; Mine shows yours plus unassigned ones and says
 * how many of whose are hidden; Take it never steals one someone owns;
 * moving campaigns keeps the owner. Owners come from the team list
 * (2026-09-29): a teammate needs no login, signing in links the teammate
 * with that email (once, even when two pages load at once), a deal assigned
 * before the list existed is handed to its login's member, a switched-off
 * teammate isn't offered, Undo puts back only what nobody changed since,
 * and a teammate removed leaves their deals unassigned. The shared users
 * table is only read — never written — by this check.
 */
import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { db, schema } from "./db";
import {
  addTeammate,
  chipLabels,
  emptyListMessage,
  hiddenSummary,
  inView,
  listViewLine,
  memberForUser,
  parseView,
  restoreOwners,
  setOwner,
  splitByView,
  splitForList,
  takeUnassigned,
  updateTeammate,
  type MemberId,
} from "../src/lib/owners";
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
  const me = "me" as MemberId;
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
  // NEGATIVE (second review, 2026-09-28): on Mine with none of your own, a search with no match said "No creators yet" and dropped the hidden count.
  const kierans = Array.from({ length: 7 }, (_, i) => ({ ownerId: "k", ownerName: "Kieran Lee", name: `K${i}` }));
  const zzz = splitForList(kierans, "mine", me, (r) => r.name.includes("zzz"));
  check("a search that matches nothing says so — not 'no creators yet'", emptyListMessage({ searching: true, total: zzz.total, hiddenAll: zzz.hiddenAll, hiddenMatching: zzz.hidden }).kind === "no_match");
  check("…and still says how many of Kieran's aren't shown", listViewLine({ searching: true, hiddenAll: zzz.hiddenAll, hiddenMatching: zzz.hidden }) === "7 of Kieran's not shown");
  const noSearch = splitForList(kierans, "mine", me, null);
  check("without a search: nothing of yours, and whose there are", emptyListMessage({ searching: false, total: noSearch.total, hiddenAll: noSearch.hiddenAll, hiddenMatching: noSearch.hidden }).kind === "only_teammates");
  check("a search matching only theirs points to Everyone", emptyListMessage({ searching: true, total: bob.total, hiddenAll: bob.hiddenAll, hiddenMatching: bob.hidden }).kind === "teammates_match" && listViewLine({ searching: true, hiddenAll: bob.hiddenAll, hiddenMatching: bob.hidden }) === "2 of Kieran's also match");
  check("truly empty is 'no creators yet'", emptyListMessage({ searching: false, total: 0, hiddenAll: [], hiddenMatching: [] }).kind === "empty");

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
  const [login] = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).limit(1);
  if (!login) return check("a login exists to test with", false);
  const loginUser = { id: login.id, name: login.name, email: login.email, kind: "agency" as const };
  const NONE = "00000000-0000-0000-0000-000000000000";
  let campaignA = NONE;
  let campaignB = NONE;
  const creatorIds: string[] = [];
  const madeMembers: string[] = [];
  let brandLogin: string | null = null;
  const [preexisting] = await db.select({ id: schema.cmTeamMembers.id }).from(schema.cmTeamMembers).where(eq(schema.cmTeamMembers.userId, login.id));
  // Review 2026-09-29: linking this login hands its old login-owned deals to the new
  // member; deleting that member afterwards must hand them back, not leave them unowned.
  const legacyBefore = (
    await db
      .select({ id: schema.cmPartnerships.id })
      .from(schema.cmPartnerships)
      .where(and(eq(schema.cmPartnerships.legacyOwnerUserId, login.id), isNull(schema.cmPartnerships.ownerId)))
  ).map((r) => r.id);
  let planted: string | null = null;
  let plantedBack = false;
  const add = async (h: string, campaignId: string) => {
    const r = await createCreatorWithPartnership({ clientId: client.id, name: h, links: [`https://www.instagram.com/${h}`], campaignId, userId: login.id });
    creatorIds.push(r.creatorId);
    return r.partnershipId;
  };
  const row = async (id: string) => (await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, id)))[0];
  const ownerOf = async (id: string) => (await row(id))?.ownerId ?? null;
  try {
    campaignA = await ensureCampaignByName(client.id, "__verify_owners_a__");
    campaignB = await ensureCampaignByName(client.id, "__verify_owners_b__");

    console.log("\n── The team list ──");
    if (!preexisting) {
      planted = await add("__verify_owner_legacy", campaignA);
      await db.update(schema.cmPartnerships).set({ ownerId: null, legacyOwnerUserId: login.id }).where(eq(schema.cmPartnerships.id, planted));
      legacyBefore.push(planted);
    }
    if (!preexisting && login.email) {
      // Added by hand with the login's email, before they ever signed in.
      const linked = await addTeammate({ name: "__verify Linked", email: login.email.toUpperCase() });
      if (linked.ok) madeMembers.push(linked.id);
      const [m1, m2] = await Promise.all([memberForUser(loginUser), memberForUser(loginUser)]);
      const forLogin = await db.select({ id: schema.cmTeamMembers.id }).from(schema.cmTeamMembers).where(eq(schema.cmTeamMembers.userId, login.id));
      check("signing in links the teammate added with that email — once, even when two pages load at once", linked.ok && m1?.id === linked.id && m2?.id === linked.id && forLogin.length === 1, JSON.stringify({ linked, m1, m2, n: forLogin.length }));
    }
    const me = await memberForUser(loginUser);
    if (!me) return check("the login has a team member", false);
    if (!preexisting && !madeMembers.includes(me.id)) madeMembers.push(me.id);
    check("a brand's portal login never gets a team member", (await memberForUser({ ...loginUser, kind: "client" as unknown as "agency" })) === null);
    const kieran = await addTeammate({ name: "__verify Kieran", email: "__verify_kieran@example.test" });
    if (kieran.ok) madeMembers.push(kieran.id);
    check("a teammate can be added without a login", kieran.ok);
    if (!kieran.ok) return;
    const dupe = await addTeammate({ name: "__verify Again", email: "__VERIFY_KIERAN@example.test" });
    if (dupe.ok) madeMembers.push(dupe.id);
    check("the same email twice (any case) is refused", !dupe.ok);
    const [brand] = await db.insert(schema.cmClientUsers).values({ clientId: client.id, name: "__verify Brand", email: "__verify_brand_person@example.test" }).returning({ id: schema.cmClientUsers.id });
    brandLogin = brand.id;
    const brandAsTeammate = await addTeammate({ name: "__verify Brand", email: "__verify_brand_person@example.test" });
    if (brandAsTeammate.ok) madeMembers.push(brandAsTeammate.id);
    check("a brand's portal login can't be put on the team", !brandAsTeammate.ok);

    console.log("\n── Assigning ──");
    const a = await add("__verify_ow_a", campaignA);
    const b = await add("__verify_ow_b", campaignA);
    check("a new deal starts unassigned, even when someone added it", (await ownerOf(a)) === null);
    const before = (await row(a)).updatedAt;
    const set = await setOwner([a], kieran.id);
    check("a teammate without a login can own a deal", set.ok && (await ownerOf(a)) === kieran.id);
    check("…without touching updatedAt (the email check files mail by it)", (await row(a)).updatedAt.getTime() === before.getTime());
    const rows = await getCreatorRows(client.id, { campaignId: campaignA, withOutreach: false });
    check("rows carry the owner's name from the team list", rows.find((r) => r.partnershipId === a)?.ownerName === "__verify Kieran" && rows.find((r) => r.partnershipId === b)?.ownerId === null);
    check("…and the change says who owned it before, for Undo", set.ok && set.prior.length === 1 && set.prior[0].id === a && set.prior[0].ownerId === null);
    const undone = set.ok ? await restoreOwners(set.prior, kieran.id) : { restored: 0 };
    check("Undo puts it back", undone.restored === 1 && (await ownerOf(a)) === null);
    await setOwner([a], me.id);
    const late = set.ok ? await restoreOwners(set.prior, kieran.id) : { restored: 1 };
    check("…but not over a change someone made since", late.restored === 0 && (await ownerOf(a)) === me.id);
    const bogus = await setOwner([b], "11111111-1111-4111-8111-111111111111");
    check("an id that isn't on the team is refused, and nothing changes", !bogus.ok && (await ownerOf(b)) === null);
    await updateTeammate(kieran.id, { active: false });
    const off = await setOwner([b], kieran.id);
    check("a switched-off teammate isn't assignable", !off.ok && (await ownerOf(b)) === null);
    await updateTeammate(kieran.id, { active: true });
    await db.update(schema.cmPartnerships).set({ legacyOwnerUserId: login.id }).where(eq(schema.cmPartnerships.id, b));
    await setOwner([b], null);
    check("unassigning also clears the old login owner, so it can't be handed back", (await row(b)).legacyOwnerUserId === null && (await ownerOf(b)) === null);

    console.log("\n── A deal assigned before the team list ──");
    const early = await add("__verify_ow_early", campaignA);
    await db.update(schema.cmPartnerships).set({ legacyOwnerUserId: login.id, ownerId: null }).where(eq(schema.cmPartnerships.id, early));
    await memberForUser(loginUser);
    const e = await row(early);
    check("is handed to that login's team member the next time they open the app", e.ownerId === me.id && e.legacyOwnerUserId === null);

    console.log("\n── Take it ──");
    await setOwner([a], kieran.id);
    const took = await takeUnassigned([a, b], me.id);
    check("Take it claims only the unassigned one", took.taken === 1 && took.alreadyOwned === 1 && (await ownerOf(b)) === me.id && (await ownerOf(a)) === kieran.id);

    console.log("\n── The owner stays with the deal ──");
    const moved = await moveToCampaign([a], campaignB);
    check("moving to another campaign keeps the owner", (moved.moved ?? 0) === 1 && (await ownerOf(a)) === kieran.id);

    console.log("\n── Today on Mine ──");
    const c = await add("__verify_ow_c", campaignA);
    await setOwner([c], kieran.id);
    // NEGATIVE (review, 2026-09-28): their Posted and closed deals were counted as "not shown" though Today never lists them.
    const posted = await add("__verify_ow_posted", campaignA);
    const closed = await add("__verify_ow_closed", campaignA);
    await db.insert(schema.cmDeliverables).values({ partnershipId: posted, url: "https://www.instagram.com/reel/__verify_ow/" });
    await db.update(schema.cmPartnerships).set({ stage: "posted" }).where(eq(schema.cmPartnerships.id, posted));
    await db.update(schema.cmPartnerships).set({ stage: "declined" }).where(eq(schema.cmPartnerships.id, closed));
    await setOwner([posted, closed], kieran.id);
    const mine = await getTodayData({ clientId: client.id, campaignId: campaignA, view: "mine", me: me.id });
    const everyone = await getTodayData({ clientId: client.id, campaignId: campaignA, view: "all", me: me.id });
    check("Mine leaves out a teammate's deal and says so", !mine.rows.some((r) => r.partnershipId === c) && mine.hiddenSummary === "1 of __verify's not shown", mine.hiddenSummary ?? "none");
    check("…counting only what Today would have listed (not their Posted or closed deals)", mine.hiddenSummary === "1 of __verify's not shown");
    check("…and counts only what it shows", Object.values(mine.stageCounts).reduce((s, n) => s + (n ?? 0), 0) === Object.values(everyone.stageCounts).reduce((s, n) => s + (n ?? 0), 0) - 3);
    check("Everyone shows it", everyone.rows.some((r) => r.partnershipId === c) && everyone.hiddenSummary === null);
    await db.delete(schema.cmTeamMembers).where(eq(schema.cmTeamMembers.id, kieran.id));
    madeMembers.splice(madeMembers.indexOf(kieran.id), 1);
    check("a teammate removed from the list leaves their deals unassigned", (await ownerOf(c)) === null && (await ownerOf(a)) === null);
  } finally {
    if (madeMembers.length) await db.delete(schema.cmTeamMembers).where(inArray(schema.cmTeamMembers.id, madeMembers));
    // Hand back what the test's member adopted (the FK left those deals with no owner).
    if (!preexisting && legacyBefore.length) {
      await db
        .update(schema.cmPartnerships)
        .set({ legacyOwnerUserId: login.id })
        .where(and(inArray(schema.cmPartnerships.id, legacyBefore), isNull(schema.cmPartnerships.ownerId), isNull(schema.cmPartnerships.legacyOwnerUserId)));
    }
    if (planted) plantedBack = (await row(planted))?.legacyOwnerUserId === login.id;
    if (creatorIds.length) await db.delete(schema.cmCreators).where(inArray(schema.cmCreators.id, creatorIds));
    await db.delete(schema.cmCampaigns).where(inArray(schema.cmCampaigns.id, [campaignA, campaignB]));
    if (madeMembers.length) await db.delete(schema.cmTeamMembers).where(inArray(schema.cmTeamMembers.id, madeMembers));
    if (brandLogin) await db.delete(schema.cmClientUsers).where(eq(schema.cmClientUsers.id, brandLogin));
  }
  if (planted) check("a login-owned deal the test's member adopted goes back to that login afterwards", plantedBack);
  check("test rows cleaned up", (await db.select().from(schema.cmCampaigns).where(inArray(schema.cmCampaigns.id, [campaignA, campaignB]))).length === 0);
  check(
    "no test teammates left, and the login is on the team only if it was before",
    (await db.select().from(schema.cmTeamMembers).where(like(schema.cmTeamMembers.name, "__verify%"))).length === 0 &&
      (await db.select().from(schema.cmTeamMembers).where(and(eq(schema.cmTeamMembers.userId, login.id)))).length === (preexisting ? 1 : 0),
  );
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
