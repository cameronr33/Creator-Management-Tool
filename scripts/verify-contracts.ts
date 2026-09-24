/**
 * Verifies contract PDFs on the Deal card (2026-09-24).
 *
 *   npm run preview:verify -- scripts/verify-contracts.ts
 *
 * Only real PDFs up to 10 MB are kept, the same file once per deal; reading
 * fills the deal's blanks (deal-facts.ts); a document that isn't a contract
 * fills nothing; a failed read is recorded and can be read again; a file is
 * never read twice at once; and one client can't reach another's contracts.
 * The model is a fake here — no key needed.
 */
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import {
  MAX_CONTRACT_BYTES,
  attachDownloaded,
  contractOfClient,
  contractsToDownload,
  governingContract,
  isPdf,
  isStaleRead,
  looksLikeContract,
  namesThisCreator,
  listContracts,
  markForReread,
  readContract,
  readPendingContracts,
  safeFilename,
  storeUpload,
  type ContractReader,
} from "../src/lib/contracts";
import type { DealFacts } from "../src/lib/deal-facts";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const pdf = (s: string) => new Uint8Array(Buffer.from(`%PDF-1.7\n${s}\n%%EOF`, "latin1"));
const FACTS: DealFacts = {
  is_contract: true,
  creator_name: null,
  signed: true,
  products: [{ name: "Wiper blades", quantity: 2 }],
  compensation_type: "flat_fee",
  fee_amount: 750,
  terms: "Three reels in 45 days.",
  recipient_name: null,
  address: "5 Pine Ave, Boise, ID 83702",
};
const good: ContractReader = async () => FACTS;

async function main() {
  console.log("\n── Pure ──");
  check("a PDF is recognised by its bytes, not its name", isPdf(pdf("x")) && !isPdf(new Uint8Array(Buffer.from("<html>%PDF-"))) && !isPdf(new Uint8Array()));
  check("file names can't carry paths or quotes", safeFilename('..\\..\\evil"/name.pdf') === ".. .. evil name.pdf" && safeFilename("") === "contract.pdf");
  const t = (d: number) => new Date(2026, 8, d);
  const g = governingContract([
    { readStatus: "read" as const, extracted: { ...FACTS, signed: false }, receivedAt: t(20) },
    { readStatus: "read" as const, extracted: FACTS, receivedAt: t(10) },
    { readStatus: "not_contract" as const, extracted: FACTS, receivedAt: t(25) },
  ]);
  check("the signed contract governs, even over a later unsigned draft", g?.receivedAt.getDate() === 10);
  check(
    "a contract is this creator's when it shares a word of their name or their handle — or names no one",
    namesThisCreator("Jane M. Driver", { name: "Jane Driver" }) &&
      namesThisCreator("@janedrives LLC", { name: "JD", username: "janedrives" }) &&
      namesThisCreator(null, { name: "Jane" }) &&
      !namesThisCreator("Sarah Lopez", { name: "Jane Driver", username: "janedrives" }),
  );
  check("our own PDFs count only when they look like a contract", looksLikeContract("HELLA_Agreement_v2.pdf", null) && looksLikeContract("scan.pdf", "Signed contract attached") && !looksLikeContract("Creative brief.pdf", "Your brief"));
  check("a read claimed 11 minutes ago is stale; one a minute ago isn't", isStaleRead({ readStatus: "reading", readAt: new Date(Date.now() - 11 * 60_000) }) && !isStaleRead({ readStatus: "reading", readAt: new Date(Date.now() - 60_000) }));

  const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.slug, "hella")).limit(1);
  const NONE = "00000000-0000-0000-0000-000000000000";
  let other = { id: NONE };
  let campaignId = NONE;
  const creatorIds: string[] = [];
  const add = async (h: string) => {
    const r = await createCreatorWithPartnership({ clientId: client.id, name: h, links: [`https://www.instagram.com/${h}`], campaignId });
    creatorIds.push(r.creatorId);
    return r.partnershipId;
  };
  const contract = async (id: string) => (await db.select().from(schema.cmContracts).where(eq(schema.cmContracts.id, id)))[0];
  try {
    [other] = await db.insert(schema.clients).values({ name: "__verify_ct_other", slug: `__verify_ct_${Date.now()}` }).returning();
    campaignId = await ensureCampaignByName(client.id, "__verify_contracts__");
    const p = await add("__verify_ct_a");

    console.log("\n── Uploading ──");
    check("a file that isn't a PDF is refused", !(await storeUpload(p, { filename: "x.pdf", bytes: new Uint8Array(Buffer.from("MZ not a pdf")) }, null)).ok);
    const big = new Uint8Array(MAX_CONTRACT_BYTES + 1);
    big.set(pdf(""));
    check("a PDF over 10 MB is refused", !(await storeUpload(p, { filename: "big.pdf", bytes: big }, null)).ok);
    const first = await storeUpload(p, { filename: "deal.pdf", bytes: pdf("v1") }, null);
    check("a PDF is kept", first.ok && !first.duplicate);
    const again = await storeUpload(p, { filename: "deal (1).pdf", bytes: pdf("v1") }, null);
    check("the same file again is stored once", again.ok && again.duplicate && first.ok && again.id === first.id);
    if (!first.ok) return check("the first upload was stored", false);
    const listed = await listContracts(p);
    check("the deal's list never carries the file itself", listed.length === 1 && !("data" in listed[0]) && listed[0].downloaded);

    console.log("\n── Reading ──");
    const read = await readContract(first.id, { reader: good });
    const c1 = await contract(first.id);
    const [pr] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, p));
    check("reading fills the deal's blanks", read.status === "read" && Number(pr.feeAmount) === 750 && pr.agreementType === "signed" && pr.addressLine1 === "5 Pine Ave", JSON.stringify(read));
    check("…and records what it read and filled", c1.readStatus === "read" && (c1.extracted as DealFacts).fee_amount === 750 && Array.isArray(c1.filled) && (c1.filled as string[]).length >= 4);
    check("a contract already read isn't read again by itself", (await readContract(first.id, { reader: good })).status === "skipped");
    let calls = 0;
    const slow: ContractReader = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 200));
      return FACTS;
    };
    const p2 = await add("__verify_ct_b");
    const second = await storeUpload(p2, { filename: "b.pdf", bytes: pdf("b") }, null);
    if (!second.ok) return check("the second upload was stored", false);
    const both = await Promise.all([readContract(second.id, { reader: slow }), readContract(second.id, { reader: slow })]);
    check("two reads at once: the file is read exactly once", calls === 1 && both.filter((o) => o.status === "read").length === 1, JSON.stringify(both));

    const kit = await storeUpload(p, { filename: "media-kit.pdf", bytes: pdf("kit") }, null);
    if (!kit.ok) return check("the media kit was stored", false);
    const before = (await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.partnershipId, p))).length;
    const nc = await readContract(kit.id, { reader: async () => ({ ...FACTS, is_contract: false, fee_amount: 99999 }) });
    const [pr2] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, p));
    check("a document that isn't a contract fills nothing", nc.status === "not_contract" && Number(pr2.feeAmount) === 750 && (await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.partnershipId, p))).length === before);
    check("…and its bytes aren't kept", (await contract(kit.id)).data === null);

    const pOther = await add("__verify_ct_named");
    const sarahs = await storeUpload(pOther, { filename: "reference.pdf", bytes: pdf("sarah") }, null);
    if (!sarahs.ok) return check("the reference upload was stored", false);
    const wrong = await readContract(sarahs.id, { reader: async () => ({ ...FACTS, creator_name: "Sarah Lopez" }) });
    const [po] = await db.select().from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, pOther));
    check("a contract with someone else fills nothing, and says whose it is", wrong.status === "not_contract" && po.feeAmount === null && po.addressLine1 === null && /Sarah Lopez/.test((await contract(sarahs.id)).readError ?? ""));

    const p3 = await add("__verify_ct_c");
    const broken = await storeUpload(p3, { filename: "c.pdf", bytes: pdf("c") }, null);
    if (!broken.ok) return check("the third upload was stored", false);
    const failed = await readContract(broken.id, { reader: async () => { throw new Error("the document could not be processed"); } });
    const cf = await contract(broken.id);
    check("a failed read is recorded, with why", failed.status === "failed" && cf.readStatus === "failed" && cf.attempts === 1 && /could not be processed/.test(cf.readError ?? ""));
    const nothing = await readContract(broken.id, { reader: async () => null });
    check("…a reading that comes back empty counts as failed too", nothing.status === "failed" && (await contract(broken.id)).attempts === 2);
    await markForReread(broken.id);
    const retried = await readPendingContracts({ reader: good, ids: [broken.id] });
    check("'Read again' puts it back in the queue, and the next run reads it", retried.read === 1 && (await contract(broken.id)).readStatus === "read");

    const p4 = await add("__verify_ct_stuck");
    const stuckRead = await storeUpload(p4, { filename: "d.pdf", bytes: pdf("d") }, null);
    if (!stuckRead.ok) return check("the fourth upload was stored", false);
    await db.update(schema.cmContracts).set({ readStatus: "reading", readAt: new Date(Date.now() - 11 * 60_000) }).where(eq(schema.cmContracts.id, stuckRead.id));
    const recovered = await readPendingContracts({ reader: good, ids: [stuckRead.id] });
    check("a read that died mid-way (a deploy) is picked up again", recovered.read === 1 && (await contract(stuckRead.id)).readStatus === "read");
    const p5 = await add("__verify_ct_throw");
    const throwing = await storeUpload(p5, { filename: "e.pdf", bytes: pdf("e") }, null);
    if (!throwing.ok) return check("the fifth upload was stored", false);
    // Malformed output that blows up while it's being cleaned — after the claim.
    const exploded = await readContract(throwing.id, { reader: async () => ({ ...FACTS, products: [{ name: 5 as unknown as string, quantity: 1 }] }) });
    const p6 = await add("__verify_ct_nocredit");
    const waiting = await storeUpload(p6, { filename: "f.pdf", bytes: pdf("f") }, null);
    if (!waiting.ok) return check("the sixth upload was stored", false);
    const noCredit = Object.assign(new Error('400 {"error":{"message":"Your credit balance is too low to access the Anthropic API."}}'), { status: 400 });
    const down = await readPendingContracts({ reader: async () => { throw noCredit; }, ids: [waiting.id] });
    const cw = await contract(waiting.id);
    check("no API credit: the file waits, its attempts untouched, to be read once it's back", down.failed === 0 && cw.readStatus === "pending" && cw.attempts === 0 && /unavailable/.test(cw.readError ?? ""));
    const back = await readPendingContracts({ reader: good, ids: [waiting.id] });
    check("…and is read by the next run once it is", back.read === 1 && (await contract(waiting.id)).readStatus === "read");
    check("anything going wrong after the claim is recorded as failed, never left reading", exploded.status === "failed" && (await contract(throwing.id)).readStatus === "failed", JSON.stringify(exploded));

    console.log("\n── Email attachments ──");
    const [ea] = await db.insert(schema.cmContracts).values({ partnershipId: p3, source: "email", filename: "signed.pdf", gmailMessageId: "__verify_ct_msg", gmailPartId: "2" }).returning();
    check("an attachment not downloaded yet waits for the download, not the reader", (await contractsToDownload(50)).some((r) => r.id === ea.id) && (await readContract(ea.id, { reader: good })).status === "skipped");
    check("a download that turns out not to be a PDF is dropped", (await attachDownloaded(ea.id, new Uint8Array(Buffer.from("<html>")))) === "rejected" && !(await contract(ea.id)));
    const [dup] = await db.insert(schema.cmContracts).values({ partnershipId: p3, source: "email", filename: "c-again.pdf", gmailMessageId: "__verify_ct_msg", gmailPartId: "3" }).returning();
    check("the same file sent back in a reply is dropped as a duplicate", (await attachDownloaded(dup.id, pdf("c"))) === "duplicate" && !(await contract(dup.id)));
    const [fresh] = await db.insert(schema.cmContracts).values({ partnershipId: p3, source: "email", filename: "v2.pdf", gmailMessageId: "__verify_ct_msg", gmailPartId: "4" }).returning();
    check("a new file is kept and queued for reading", (await attachDownloaded(fresh.id, pdf("v2"))) === "stored" && (await contract(fresh.id)).readStatus === "pending");
    const [stuck] = await db.insert(schema.cmContracts).values({ partnershipId: p3, source: "email", filename: "x.pdf", gmailMessageId: "__verify_ct_msg", gmailPartId: "5", attempts: 3 }).returning();
    check("an attachment that failed to download three times is given up on", !(await contractsToDownload(50)).some((r) => r.id === stuck.id));

    console.log("\n── Whose contract ──");
    check("a client reaches its own deal's contract", (await contractOfClient(client.id, first.id))?.id === first.id);
    check("another client never does", (await contractOfClient(other.id, first.id)) === null);
  } finally {
    if (creatorIds.length) await db.delete(schema.cmCreators).where(inArray(schema.cmCreators.id, creatorIds));
    await db.delete(schema.cmCampaigns).where(eq(schema.cmCampaigns.id, campaignId));
    await db.delete(schema.clients).where(eq(schema.clients.id, other.id));
  }
  check("test rows cleaned up (contracts go with their deal)", (await db.select().from(schema.cmContracts).where(eq(schema.cmContracts.gmailMessageId, "__verify_ct_msg"))).length === 0);
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
