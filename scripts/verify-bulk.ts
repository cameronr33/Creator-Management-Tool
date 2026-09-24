/**
 * Verifies cleaning up creators: removing from a campaign, deleting a
 * campaign, moving between campaigns, and a bulk stage move.
 *
 *   npm run preview:verify -- scripts/verify-bulk.ts
 */
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { deleteCampaign, moveToCampaign, removePartnerships } from "../src/lib/campaigns";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";
import { changeStage } from "../src/lib/mutations";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

async function main() {
  const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.slug, "hella")).limit(1);
  const tag = `__verify_bulk_${Date.now() % 1e6}`;
  const a = await ensureCampaignByName(client.id, `${tag} A`);
  const b = await ensureCampaignByName(client.id, `${tag} B`);
  const c = await ensureCampaignByName(client.id, `${tag} C`);
  const creatorIds: string[] = [];
  const add = async (handle: string, campaignId: string) => {
    const r = await createCreatorWithPartnership({ clientId: client.id, name: handle, links: [`https://www.instagram.com/${handle}`], campaignId });
    creatorIds.push(r.creatorId);
    return r;
  };
  const exists = async (table: "creator" | "partnership", id: string) =>
    table === "creator"
      ? (await db.select({ id: schema.cmCreators.id }).from(schema.cmCreators).where(eq(schema.cmCreators.id, id))).length > 0
      : (await db.select({ id: schema.cmPartnerships.id }).from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, id))).length > 0;

  try {
    console.log("\n── Removing from a campaign ──");
    const solo = await add(`${tag}_solo`, a);
    const both = await add(`${tag}_both`, a);
    const bothInB = await createCreatorWithPartnership({ clientId: client.id, name: "x", links: [`https://www.instagram.com/${tag}_both`], campaignId: b });
    await db.insert(schema.cmOutreachEvents).values({ partnershipId: solo.partnershipId, direction: "outbound", channel: "ig_dm", kind: "initial" });
    const r = await removePartnerships([solo.partnershipId, both.partnershipId, solo.partnershipId]);
    check("both rows removed (a repeated id counts once)", r.removed === 2, JSON.stringify(r));
    check("a creator left in no campaign is deleted completely", r.creatorsDeleted === 1 && !(await exists("creator", solo.creatorId)));
    check("…with their conversation", (await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.partnershipId, solo.partnershipId))).length === 0);
    check("a creator still in another campaign stays, in that campaign", r.creatorsKept === 1 && (await exists("creator", both.creatorId)) && (await exists("partnership", bothInB.partnershipId)));

    console.log("\n── Moving between campaigns ──");
    const m1 = await add(`${tag}_m1`, a);
    const m2 = await add(`${tag}_m2`, a);
    await createCreatorWithPartnership({ clientId: client.id, name: "m2", links: [`https://www.instagram.com/${tag}_m2`], campaignId: c });
    const moved = await moveToCampaign([m1.partnershipId, m2.partnershipId], c);
    check("a creator already in the target campaign is skipped, never merged", moved.moved === 1 && moved.skipped === 1, JSON.stringify(moved));
    const [m1Now] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, m1.partnershipId));
    check("the other one moves", m1Now.campaignId === c);
    check("moving to where it already is changes nothing", (await moveToCampaign([m1.partnershipId], c)).moved === 0);

    console.log("\n── A bulk stage move goes through the stage rules ──");
    const s = await add(`${tag}_ship`, a);
    await changeStage(s.partnershipId, "fulfilling");
    const ships = await db.select().from(schema.cmShipments).where(eq(schema.cmShipments.partnershipId, s.partnershipId));
    check("moving to Ready to ship creates the shipment", ships.length === 1 && ships[0].status === "ready");
    check("moving to Posted without a video is refused", (await changeStage(s.partnershipId, "posted")).status === "needs_video");

    console.log("\n── Deleting a campaign ──");
    const d = await deleteCampaign(client.id, a);
    check("deleting a campaign removes its creators who were only there", d.ok && !(await exists("creator", s.creatorId)), JSON.stringify(d));
    check("…and keeps those who are in another one", await exists("creator", both.creatorId));
    check("a campaign from another client can't be deleted this way", !(await deleteCampaign("00000000-0000-0000-0000-000000000000", b)).ok && (await db.select().from(schema.cmCampaigns).where(eq(schema.cmCampaigns.id, b))).length === 1);
  } finally {
    const left = creatorIds.length ? await db.select({ id: schema.cmCreators.id }).from(schema.cmCreators).where(inArray(schema.cmCreators.id, creatorIds)) : [];
    if (left.length) await db.delete(schema.cmCreators).where(inArray(schema.cmCreators.id, left.map((x) => x.id)));
    await db.delete(schema.cmCampaigns).where(inArray(schema.cmCampaigns.id, [a, b, c]));
  }
  check("test rows cleaned up", (await db.select().from(schema.cmCampaigns).where(inArray(schema.cmCampaigns.id, [a, b, c]))).length === 0);
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
