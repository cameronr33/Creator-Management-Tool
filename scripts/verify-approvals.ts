/**
 * Verifies the client's approval before outreach.
 *
 *   npm run preview:verify -- scripts/verify-approvals.ts
 *
 * With the switch off nothing waits; with it on new creators wait; the client
 * approves or passes only what's waiting for them and only their own brand's;
 * the agency can decide on their behalf; passing closes as We passed · Client
 * passed, recorded under the person who decided — never an automatic move.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { approve, pass, setApprovalRequired } from "../src/lib/approvals";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";
import { changeStage } from "../src/lib/mutations";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

async function main() {
  const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.slug, "hella")).limit(1);
  const [settingsBefore] = await db.select().from(schema.cmClientSettings).where(eq(schema.cmClientSettings.clientId, client.id));
  let other = { id: "00000000-0000-0000-0000-000000000000" };
  let campaignId = "00000000-0000-0000-0000-000000000000";
  const creatorIds: string[] = [];
  const add = async (h: string) => {
    const r = await createCreatorWithPartnership({ clientId: client.id, name: h, links: [`https://www.instagram.com/${h}`], campaignId });
    creatorIds.push(r.creatorId);
    return r.partnershipId;
  };
  const row = async (id: string) => (await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, id)))[0];
  const rob = { name: "Rob Client", kind: "client" as const, clientUserId: "00000000-0000-0000-0000-000000000001" };
  const teammate = { name: "Sam Teammate", kind: "agency" as const };
  try {
    [other] = await db.insert(schema.clients).values({ name: "__verify_ap_other", slug: `__verify_ap_${Date.now()}` }).returning();
    campaignId = await ensureCampaignByName(client.id, "__verify_approvals__");
    await setApprovalRequired(client.id, false);
    const free = await add("__verify_ap_free");
    check("switch off: a new creator doesn't wait for anyone", (await row(free)).clientApproval === null);
    check("…and the client has nothing to approve", (await approve(client.id, [free], rob)).approved === 0);

    await setApprovalRequired(client.id, true);
    const a = await add("__verify_ap_a");
    const b = await add("__verify_ap_b");
    const c = await add("__verify_ap_c");
    check("switch on: new creators wait for the client's approval", (await row(a)).clientApproval === "pending" && (await row(a)).stage === "shortlisted");

    check("another client can't approve them", (await approve(other.id, [a], { ...rob })).approved === 0 && (await row(a)).clientApproval === "pending");
    const ok = await approve(client.id, [a], rob, "Love their builds");
    const ra = await row(a);
    check("the client approves: recorded under their name, with their note", ok.approved === 1 && ra.clientApproval === "approved" && ra.approvalByName === "Rob Client" && ra.approvalNote === "Love their builds");
    check("…and approving never moves the stage", ra.stage === "shortlisted");
    const notes = await db.select().from(schema.cmOutreachEvents).where(and(eq(schema.cmOutreachEvents.partnershipId, a), eq(schema.cmOutreachEvents.kind, "note")));
    check("…with a note on the timeline", notes.some((n) => /Approved for outreach by Rob Client/.test(n.body ?? "")));
    check("the client can't pass on someone they already approved", !(await pass(client.id, a, rob)).ok);

    const passed = await pass(client.id, b, rob, "Not our audience");
    const rb = await row(b);
    check("the client passes: closed as We passed · Client passed", passed.ok && rb.stage === "passed" && rb.exitReason === "client_passed" && rb.clientApproval === "passed");
    const [t] = await db.select().from(schema.cmStageTransitions).where(and(eq(schema.cmStageTransitions.partnershipId, b), eq(schema.cmStageTransitions.toStage, "passed")));
    check("…recorded as the client's decision, by name", t?.source === "client" && (t.meta as { decidedBy?: string } | null)?.decidedBy === "Rob Client" && t.changedBy === null);

    check("another client can't pass on them", !(await pass(other.id, c, rob)).ok && (await row(c)).stage === "shortlisted");
    const forThem = await approve(client.id, [c, free], teammate);
    check("the agency can approve for the client — even someone who wasn't waiting", forThem.approved === 2 && (await row(c)).approvalByName === "Sam Teammate");

    // Security review (2026-09-24).
    const moved = await add("__verify_ap_moved");
    await changeStage(moved, "fulfilling");
    check("a creator who moved on while waiting can't be approved by the client", (await approve(client.id, [moved], rob)).approved === 0);
    check("…nor closed by the client", !(await pass(client.id, moved, rob)).ok && (await row(moved)).stage === "fulfilling" && (await row(moved)).clientApproval === "pending");
    check("the agency never approves someone already passed on", (await approve(client.id, [b], teammate)).approved === 0 && (await row(b)).clientApproval === "passed");
    const declined = await add("__verify_ap_declined");
    await changeStage(declined, "declined");
    check("…nor anyone closed", (await approve(client.id, [declined], teammate)).approved === 0);
    check("the agency can't pass on a closed deal either", !(await pass(client.id, declined, teammate)).ok && (await row(declined)).stage === "declined");
    const racy = await add("__verify_ap_racy");
    const [first, second] = await Promise.all([approve(client.id, [racy], rob), pass(client.id, racy, { ...rob, name: "Other Person" })]);
    const rr = await row(racy);
    check(
      "two people deciding at once: exactly one decision stands, and the stage agrees with it",
      (first.approved === 1) !== second.ok && (rr.clientApproval === "approved" ? rr.stage === "shortlisted" : rr.stage === "passed"),
      JSON.stringify({ first, second, a: rr.clientApproval, s: rr.stage }),
    );
  } finally {
    await db.delete(schema.cmCreators).where(inArray(schema.cmCreators.id, creatorIds.length ? creatorIds : ["00000000-0000-0000-0000-000000000000"]));
    await db.delete(schema.cmCampaigns).where(eq(schema.cmCampaigns.id, campaignId));
    await db.delete(schema.clients).where(eq(schema.clients.id, other.id));
    // Leave HELLA's settings exactly as found — including not having a row at all.
    if (settingsBefore) await setApprovalRequired(client.id, settingsBefore.requiresApproval);
    else await db.delete(schema.cmClientSettings).where(eq(schema.cmClientSettings.clientId, client.id));
  }
  check("test rows cleaned up", (await db.select().from(schema.cmCampaigns).where(eq(schema.cmCampaigns.id, campaignId))).length === 0);
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
