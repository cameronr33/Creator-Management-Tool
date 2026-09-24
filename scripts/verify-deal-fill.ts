/**
 * Verifies how a contract or an email fills in the deal (2026-09-24).
 *
 *   npm run preview:verify -- scripts/verify-deal-fill.ts
 *
 * Blank fields fill; anything a person filled is kept and offered as a
 * difference instead; verbal → signed is the only upgrade and signed never
 * goes back; products only when none are recorded; an address only when none
 * is on file and it parses completely — and then only Agreed moves to Ready
 * to ship. A hand edit landing mid-fill wins.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { NO_FACTS, applyDealFill, cleanFacts, dealDifferences, planDealFill, type DealCurrent, type DealFacts } from "../src/lib/deal-facts";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";
import { changeStage } from "../src/lib/mutations";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const EMPTY: DealCurrent = {
  agreementType: null,
  agreedTerms: null,
  compensationType: "free_product",
  feeAmount: null,
  recipientName: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  region: null,
  postalCode: null,
  products: [],
};

const CONTRACT: DealFacts = {
  is_contract: true,
  creator_name: "Jane Driver",
  signed: true,
  products: [
    { name: "Wiper blades", quantity: 2 },
    { name: "LED headlight kit", quantity: null },
  ],
  compensation_type: "hybrid",
  fee_amount: 500,
  terms: "Two Instagram reels within 30 days of delivery; 90-day usage rights.",
  recipient_name: "Jane Driver",
  address: "Jane Driver, 12 Oak Street, Austin, TX 78701",
};

function pure() {
  console.log("\n── What a contract may fill (pure) ──");
  const all = planDealFill(EMPTY, CONTRACT);
  check(
    "a blank deal: signed, fee, product + fee, terms, address and both products",
    all.agreementType === "signed" && all.feeAmount === "500.00" && all.compensationType === "hybrid" && !!all.agreedTerms && all.address?.addressLine1 === "12 Oak Street" && all.address.postalCode === "78701" && all.products?.length === 2,
    JSON.stringify(all),
  );
  check("…the recipient's name comes with the address", all.address?.recipientName === "Jane Driver");
  check("an unstated quantity counts as one", all.products?.[1].quantity === 1);

  const filled: DealCurrent = { ...EMPTY, agreementType: "signed", agreedTerms: "One reel", compensationType: "flat_fee", feeAmount: "300.00", addressLine1: "9 Elm Rd", city: "Dallas", region: "TX", postalCode: "75201", products: [{ productName: "HELLA wiper blades", quantity: 1 }] };
  const none = planDealFill(filled, CONTRACT);
  check("a filled deal: nothing is replaced", Object.keys(none).length === 0, JSON.stringify(none));
  const diffs = dealDifferences(filled, CONTRACT, { terms: true });
  const keys = diffs.map((d) => d.key.split(":")[0]);
  check("…each disagreement is offered instead: fee, terms, address, the product not listed", JSON.stringify(keys) === JSON.stringify(["fee", "terms", "address", "product"]), JSON.stringify(keys));
  check("…the product already listed under a longer name isn't offered again", !diffs.some((d) => d.product?.productName === "Wiper blades"));
  check("…and 'Use it' carries the contract's value", diffs.find((d) => d.label === "Fee")?.patch?.feeAmount === "500.00");
  check("an email's paraphrased terms are never offered as a difference", !dealDifferences(filled, CONTRACT).some((d) => d.label === "Terms"));
  check("'Keep mine' hides exactly that offer", !dealDifferences(filled, CONTRACT, { dismissed: ["fee:500.00"] }).some((d) => d.label === "Fee") && dealDifferences(filled, { ...CONTRACT, fee_amount: 600 }, { dismissed: ["fee:500.00"] }).some((d) => d.label === "Fee"));

  console.log("\n── Deal type ──");
  check("verbal → signed when a signed contract arrives", planDealFill({ ...EMPTY, agreementType: "verbal" }, CONTRACT).agreementType === "signed");
  check("signed never goes back", planDealFill({ ...EMPTY, agreementType: "signed" }, { ...CONTRACT, signed: false }, { verbal: true }).agreementType === undefined);
  check("an unsigned draft doesn't make it signed", planDealFill(EMPTY, { ...CONTRACT, signed: false }).agreementType === undefined);
  check("an email agreement makes a blank deal verbal — and only a blank one", planDealFill(EMPTY, NO_FACTS, { verbal: true }).agreementType === "verbal" && planDealFill({ ...EMPTY, agreementType: "signed" }, NO_FACTS, { verbal: true }).agreementType === undefined);

  console.log("\n── Fee and compensation ──");
  check("a fee with no type says flat fee", planDealFill(EMPTY, { ...NO_FACTS, fee_amount: 250 }).compensationType === "flat_fee");
  check("a fee someone typed stays, and so does the type they chose", Object.keys(planDealFill({ ...EMPTY, feeAmount: "100.00", compensationType: "hybrid" }, { ...NO_FACTS, fee_amount: 250 })).length === 0);
  check("nonsense amounts are dropped", cleanFacts({ ...NO_FACTS, fee_amount: -5 }).fee_amount === null && cleanFacts({ ...NO_FACTS, fee_amount: 1e9 }).fee_amount === null);

  console.log("\n── Address ──");
  check("an incomplete address never fills", planDealFill(EMPTY, { ...NO_FACTS, address: "12 Oak Street" }).address === undefined);
  check("…and isn't offered either", dealDifferences({ ...filled }, { ...NO_FACTS, address: "12 Oak Street" }).length === 0);
  check("a partly typed address isn't overwritten", planDealFill({ ...EMPTY, city: "Austin" }, CONTRACT).address === undefined);
  check("the same address, written differently, isn't a difference", dealDifferences({ ...filled, addressLine1: "12 Oak St.", postalCode: "78701" }, { ...CONTRACT, address: "12 Oak St, Austin, TX 78701" }).every((d) => d.label !== "Address"));

  console.log("\n── Products ──");
  check("products only when none are recorded", planDealFill({ ...EMPTY, products: [{ productName: "Horn", quantity: 1 }] }, CONTRACT).products === undefined);
  const many = cleanFacts({ ...NO_FACTS, products: Array.from({ length: 15 }, (_, i) => ({ name: `Part ${i}`, quantity: 1 })).concat([{ name: "part 0", quantity: 1 }]) });
  check("at most ten products, no duplicates", many.products.length === 10 && new Set(many.products.map((p) => p.name.toLowerCase())).size === 10);
}

async function live() {
  const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.slug, "hella")).limit(1);
  let campaignId = "00000000-0000-0000-0000-000000000000";
  const creatorIds: string[] = [];
  const add = async (h: string) => {
    const r = await createCreatorWithPartnership({ clientId: client.id, name: h, links: [`https://www.instagram.com/${h}`], campaignId });
    creatorIds.push(r.creatorId);
    return r.partnershipId;
  };
  const row = async (id: string) => (await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, id)))[0];
  try {
    campaignId = await ensureCampaignByName(client.id, "__verify_deal_fill__");
    console.log("\n── Filling a real deal ──");
    const agreed = await add("__verify_df_agreed");
    await changeStage(agreed, "awaiting_address");
    const r = await applyDealFill(agreed, CONTRACT, { from: "the contract deal.pdf" });
    const a = await row(agreed);
    check(
      "blank fields are filled",
      a.agreementType === "signed" && Number(a.feeAmount) === 500 && a.compensationType === "hybrid" && a.agreedTerms === CONTRACT.terms && a.addressLine1 === "12 Oak Street" && a.recipientName === "Jane Driver",
      JSON.stringify({ t: a.agreementType, f: a.feeAmount, c: a.compensationType, l: a.addressLine1 }),
    );
    const products = await db.select().from(schema.cmProductsRequested).where(eq(schema.cmProductsRequested.partnershipId, agreed));
    check("…the products are added", products.length === 2 && products.some((p) => p.productName === "Wiper blades" && p.quantity === 2));
    check("…and what was filled is reported", r.filled.length === 5, r.filled.join(" | "));
    const notes = await db.select().from(schema.cmOutreachEvents).where(and(eq(schema.cmOutreachEvents.partnershipId, agreed), eq(schema.cmOutreachEvents.kind, "note")));
    check("…with a note on the timeline naming the contract", notes.some((n) => /^Filled in from the contract deal\.pdf: signed deal, fee \$500\.00, terms, address and 2 products\.$/.test(n.body ?? "")), notes.map((n) => n.body).join(" | "));
    check("a complete address moves Agreed → Ready to ship", a.stage === "fulfilling" && r.stageChanged?.to === "fulfilling");
    const [t] = await db.select().from(schema.cmStageTransitions).where(and(eq(schema.cmStageTransitions.partnershipId, agreed), eq(schema.cmStageTransitions.toStage, "fulfilling")));
    check("…through the rule table, recorded as such", t?.source === "rule" && t.reason === "address_complete");

    const again = await applyDealFill(agreed, { ...CONTRACT, fee_amount: 900, terms: "Something else", address: "1 Other Way, Reno, NV 89501", products: [{ name: "Horn", quantity: 1 }] }, { from: "the contract v2.pdf" });
    const a2 = await row(agreed);
    check("a second contract replaces nothing already filled", again.filled.length === 0 && Number(a2.feeAmount) === 500 && a2.agreedTerms === CONTRACT.terms && a2.addressLine1 === "12 Oak Street");
    check("…adds no products to a list that has some", (await db.select().from(schema.cmProductsRequested).where(eq(schema.cmProductsRequested.partnershipId, agreed))).length === 2);
    const notes2 = await db.select().from(schema.cmOutreachEvents).where(and(eq(schema.cmOutreachEvents.partnershipId, agreed), eq(schema.cmOutreachEvents.kind, "note")));
    check("…and leaves no note when it filled nothing", notes2.length === notes.length);

    const talking = await add("__verify_df_talking");
    await changeStage(talking, "in_conversation");
    await applyDealFill(talking, CONTRACT, { from: "the contract t.pdf" });
    const tk = await row(talking);
    check("filling an address while still Talking moves nothing", tk.addressLine1 === "12 Oak Street" && tk.stage === "in_conversation");

    const quiet = await add("__verify_df_quiet");
    await changeStage(quiet, "awaiting_address");
    const q = await applyDealFill(quiet, CONTRACT, { from: "Jane's email", stageMove: false });
    check("with automatic moves off, an address from email fills in but moves nothing", q.stageChanged === null && (await row(quiet)).stage === "awaiting_address" && (await row(quiet)).addressLine1 === "12 Oak Street");

    const twice = await add("__verify_df_twice");
    await Promise.all([applyDealFill(twice, CONTRACT, { from: "the contract a.pdf" }), applyDealFill(twice, CONTRACT, { from: "Jane's email" })]);
    const twiceProducts = await db.select().from(schema.cmProductsRequested).where(eq(schema.cmProductsRequested.partnershipId, twice));
    check("two fills at once add the products once", twiceProducts.length === 2, String(twiceProducts.length));

    console.log("\n── A hand edit made mid-fill wins ──");
    const racy = await add("__verify_df_racy");
    const raced = await applyDealFill(racy, CONTRACT, {
      from: "the contract r.pdf",
      afterRead: async () => {
        await db.update(schema.cmPartnerships).set({ feeAmount: "123.00", compensationType: "flat_fee", agreedTerms: "Typed by hand", city: "Houston" }).where(eq(schema.cmPartnerships.id, racy));
      },
    });
    const rc = await row(racy);
    check("the typed fee, type and terms stand", Number(rc.feeAmount) === 123 && rc.compensationType === "flat_fee" && rc.agreedTerms === "Typed by hand", JSON.stringify({ f: rc.feeAmount, c: rc.compensationType, t: rc.agreedTerms }));
    check("a partly typed address isn't completed over", rc.city === "Houston" && rc.addressLine1 === null);
    check("…and only what was really filled is reported", !raced.filled.some((f) => /fee|terms|address/.test(f)) && raced.filled.includes("signed deal"), raced.filled.join(" | "));
  } finally {
    if (creatorIds.length) await db.delete(schema.cmCreators).where(inArray(schema.cmCreators.id, creatorIds));
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
