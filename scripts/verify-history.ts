/**
 * Verifies a creator's stage history (2026-09-28).
 *
 *   npm run preview:verify -- scripts/verify-history.ts
 *
 * Part 1 (pure): every kind of move reads right — added, a person, a rule
 * (and what set it off: a logged message, their email, the brand's portal,
 * a teammate's save), the email reader with its quote, the client's pass,
 * the stage clean-up — every rule has its past-tense line, and an undo folds
 * into the move it undid.
 * Part 2 (live DB, self-cleaning): one creator taken through a manual move,
 * a rule move from a logged reply, an email move undone, the brand marking it
 * shipped, and a quick press undone — read back with names. Throwaway
 * __verify_ rows, cleaned up in finally.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { buildHistory, getStageHistory, whoMoved, type HistoryRow } from "../src/lib/history";
import { AUTO_TRIGGER_PAST } from "../src/lib/stages";
import { AUTO_STAGE_RULES } from "../src/lib/auto-stage";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";
import { changeStage } from "../src/lib/mutations";
import { logMessage } from "../src/lib/logging";
import { moveStage } from "../src/lib/stage-moves";
import { undoMove } from "../src/lib/email-status";
import { recordShipment } from "../src/lib/shipments";
import { undoQuickAction } from "../src/lib/quick-actions";
import { shortDate } from "../src/lib/format";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

function pure() {
  console.log("\n── Every kind of move reads right ──");
  const at = new Date("2026-09-25T18:00:00Z");
  const row = (r: Partial<HistoryRow>): HistoryRow => ({
    id: "t1",
    fromStage: "contacted",
    toStage: "in_conversation",
    changedAt: at,
    source: "manual",
    reason: null,
    meta: null,
    undoneAt: null,
    byName: "Kieran",
    evidence: null,
    ...r,
  });
  const who = (r: Partial<HistoryRow>) => whoMoved(row(r), "HELLA");
  check("added", who({ fromStage: null, toStage: "shortlisted", reason: "added", byName: "Cameron" }) === "Added as To contact · Cameron");
  check("a person", who({}) === "Kieran");
  check("a person we don't have a name for", who({ byName: null }) === "A teammate");
  check("a row from before sources were recorded reads as a person's", who({ source: null }) === "Kieran");
  check("a rule set off by a logged reply", who({ source: "rule", reason: "inbound_message", meta: { trigger: "inbound_message" }, byName: "Cameron", evidence: { occurredAt: at, synced: false, loggedByName: "Cameron" } }) === "By itself when they replied · logged by Cameron");
  check("a rule set off by their email", who({ source: "rule", meta: { trigger: "inbound_message" }, byName: null, evidence: { occurredAt: at, synced: true, loggedByName: null } }) === "By itself when they replied · in their email");
  check("a rule set off in the brand's portal", who({ source: "rule", fromStage: "fulfilling", toStage: "shipped", meta: { trigger: "shipment_shipped", byClient: "Rob Tinson" }, byName: null }) === "By itself when it was marked shipped · Rob Tinson at HELLA, in their portal");
  check("a rule set off by a teammate's save", who({ source: "rule", fromStage: "awaiting_address", toStage: "fulfilling", meta: { trigger: "address_complete" } }) === "By itself when their full shipping address was saved · Kieran");
  check("straight on to Ready to ship says why", /straight to Ready to ship/.test(who({ toStage: "fulfilling", meta: { continuedFrom: "awaiting_address" } })));
  check("the email reader, with the date of the email", who({ source: "email", byName: null, reason: "Send it over!", evidence: { occurredAt: at, synced: true, loggedByName: null } }) === `From their email of ${shortDate(at)}`);
  check("the client's pass", who({ source: "client", toStage: "passed", byName: null, meta: { decidedBy: "Rob Tinson" } }) === "Rob Tinson at HELLA, in their portal");
  check("the stage clean-up", who({ source: "migration", byName: null }) === "When the stages were simplified");
  const triggers = Object.keys(AUTO_STAGE_RULES).sort().join();
  check("every rule has its past-tense line", Object.keys(AUTO_TRIGGER_PAST).sort().join() === triggers && Object.values(AUTO_TRIGGER_PAST).every((s) => s.trim().length > 0));

  console.log("\n── Undo folds into the move it undid ──");
  const later = new Date(at.getTime() + 60_000);
  const items = buildHistory(
    [
      row({ id: "u1", fromStage: "awaiting_address", toStage: "in_conversation", reason: "undo", meta: { undoOf: "e1" }, changedAt: later, byName: "Sam" }),
      row({ id: "e1", fromStage: "in_conversation", toStage: "awaiting_address", source: "email", reason: "Deal — send it!", byName: null, undoneAt: later, evidence: { occurredAt: at, synced: true, loggedByName: null } }),
      row({ id: "e0", source: "email", reason: "Sounds great", byName: null }),
      row({ id: "u9", reason: "undo", meta: {}, byName: "Sam" }),
    ],
    { clientName: "HELLA", undoableId: "e0" },
  );
  const ids = items.map((i) => i.id).join();
  check("the undo row itself isn't listed; an unpaired one is", ids === "e1,e0,u9", ids);
  const e1 = items.find((i) => i.id === "e1");
  check("the undone move says who undid it and when", e1?.undone?.by === "Sam" && e1.undone.at.getTime() === later.getTime());
  check("…and keeps the quote that moved it", e1?.quote === "Deal — send it!");
  check("only the latest undoable email move gets an Undo button", items.filter((i) => i.undoable).map((i) => i.id).join() === "e0");
  check("an unpaired undo reads as one", items.find((i) => i.id === "u9")?.who === "Undo · Sam");
  const passNote = buildHistory([row({ source: "client", toStage: "passed", reason: "Not our look", meta: { decidedBy: "Rob" } })], { clientName: "HELLA" });
  const passPlain = buildHistory([row({ source: "client", toStage: "passed", reason: "client passed", meta: { decidedBy: "Rob" } })], { clientName: "HELLA" });
  check("a pass shows the client's note, never the placeholder reason", passNote[0]?.quote === "Not our look" && passPlain[0]?.quote === null);
}

async function live() {
  console.log("\n── Live: one creator's moves, read back with names (cleaned up after) ──");
  const [client] = await db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients).where(eq(schema.clients.slug, "hella")).limit(1);
  const [me] = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).limit(1);
  if (!client || !me) {
    check("HELLA and a teammate exist to test with", false);
    return;
  }
  const myName = me.name ?? "A teammate";
  let campaignId = "00000000-0000-0000-0000-000000000000";
  let creatorId: string | null = null;
  try {
    campaignId = await ensureCampaignByName(client.id, "__verify_history__");
    const made = await createCreatorWithPartnership({ clientId: client.id, name: "__verify_hist", links: ["https://www.instagram.com/__verify_hist"], campaignId, userId: me.id });
    creatorId = made.creatorId;
    const p = made.partnershipId;

    await changeStage(p, "contacted", me.id);
    await logMessage({ partnershipId: p, direction: "inbound", channel: "ig_dm", kind: "reply" }, me.id);
    const [mail] = await db
      .insert(schema.cmOutreachEvents)
      .values({ partnershipId: p, direction: "inbound", channel: "email", kind: "reply", senderRole: "creator", body: "Deal — send it over!", occurredAt: new Date(), externalId: "__verify_hist_mail" })
      .returning({ id: schema.cmOutreachEvents.id, occurredAt: schema.cmOutreachEvents.occurredAt });
    const byEmail = await moveStage({ partnershipId: p, to: "awaiting_address", source: "email", expectFrom: "in_conversation", reason: "Deal — send it over!", evidenceEventId: mail.id });
    if (byEmail.status === "moved") await undoMove(byEmail.transitionId, me.id);
    await changeStage(p, "fulfilling", me.id);
    await recordShipment({ partnershipId: p, status: "shipped" }, { kind: "client", id: "00000000-0000-0000-0000-000000000009", name: "Rob Client" });
    const delivered = await recordShipment({ partnershipId: p, status: "delivered" }, { kind: "agency", userId: me.id });
    if (delivered.ok && delivered.undo) await undoQuickAction(delivered.undo.actionId, me.id);

    const items = buildHistory(await getStageHistory(p), { clientName: client.name });
    const lines = items.map((i) => `${i.from ?? "·"}→${i.to} | ${i.who}${i.undone ? ` | undone by ${i.undone.by}` : ""}`);
    const expect = [
      `shipped→content_pending | By itself when it was marked delivered · ${myName} | undone by ${myName}`,
      `fulfilling→shipped | By itself when it was marked shipped · Rob Client at ${client.name}, in their portal`,
      `in_conversation→fulfilling | ${myName}`,
      `in_conversation→awaiting_address | From their email of ${shortDate(mail.occurredAt)} | undone by ${myName}`,
      `contacted→in_conversation | By itself when they replied · logged by ${myName}`,
      `shortlisted→contacted | ${myName}`,
      `·→shortlisted | Added as To contact · ${myName}`,
    ];
    check("the whole history, newest first, with who did what", lines.join("\n") === expect.join("\n"), `\n      got:\n        ${lines.join("\n        ")}`);
    check("the email move keeps its quote", items.find((i) => i.to === "awaiting_address")?.quote === "Deal — send it over!");
    check("the undo rows themselves aren't listed", items.length === 7);
  } finally {
    if (creatorId) await db.delete(schema.cmCreators).where(eq(schema.cmCreators.id, creatorId));
    await db.delete(schema.cmCampaigns).where(eq(schema.cmCampaigns.id, campaignId));
  }
  check("test rows cleaned up", (await db.select().from(schema.cmCampaigns).where(eq(schema.cmCampaigns.id, campaignId))).length === 0);
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
