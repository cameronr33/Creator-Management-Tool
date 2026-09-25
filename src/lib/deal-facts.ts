import { z } from "zod";
import { eq, sql, type AnyColumn } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmOutreachEvents, cmPartnerships, cmProductsRequested, type CmPartnership } from "@/lib/db/schema";
import { hasCompleteAddress, parseAddress, type ParsedAddress } from "@/lib/address";
import { advanceIfDealReady, applyAutoStage, type AutoStageResult } from "@/lib/auto-stage";

/**
 * The deal as a contract or an email states it — product, fee, terms,
 * address — and the one rule for writing it (owner decision, 2026-09-24):
 * a blank field is filled straight away; a field someone already filled is
 * never replaced — where the source says otherwise it's offered as a
 * difference ("The contract says $500 — Use it"). The only upgrade is a
 * verbal deal becoming signed when a signed contract arrives.
 *
 * Contracts and emails are untrusted input: only these structured fields are
 * taken from them, every value is capped and checked, and the only stage
 * effect is the existing forward-only address_complete rule.
 */

export const DealFactsSchema = z.object({
  is_contract: z.boolean(),
  /** The creator the document is with, as written in it — checked against this deal's creator. */
  creator_name: z.string().nullable(),
  signed: z.boolean(),
  products: z.array(z.object({ name: z.string(), quantity: z.number().int().nullable() })),
  compensation_type: z.enum(["free_product", "flat_fee", "hybrid"]).nullable(),
  fee_amount: z.number().nullable(),
  terms: z.string().nullable(),
  recipient_name: z.string().nullable(),
  address: z.string().nullable(),
});
export type DealFacts = z.infer<typeof DealFactsSchema>;

/** What the email reader keeps on the partnership (cm_partnerships.email_deal). */
export interface EmailDeal {
  facts: DealFacts;
  /** The message the deal was read from. */
  eventId: string | null;
  at: string;
}

export const NO_FACTS: DealFacts = {
  is_contract: false,
  creator_name: null,
  signed: false,
  products: [],
  compensation_type: null,
  fee_amount: null,
  terms: null,
  recipient_name: null,
  address: null,
};

const MAX_PRODUCTS = 10;

function text(s: string | null | undefined, max: number): string | null {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

function squash(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Pure: facts trimmed, capped and sanity-checked — whatever the model returned. */
export function cleanFacts(f: DealFacts): DealFacts {
  const seen = new Set<string>();
  const products: DealFacts["products"] = [];
  for (const p of f.products ?? []) {
    const name = text(p.name, 120);
    if (!name || seen.has(squash(name))) continue;
    seen.add(squash(name));
    const q = p.quantity && Number.isFinite(p.quantity) ? Math.min(Math.max(Math.round(p.quantity), 1), 100) : 1;
    products.push({ name, quantity: q });
    if (products.length >= MAX_PRODUCTS) break;
  }
  const fee = typeof f.fee_amount === "number" && Number.isFinite(f.fee_amount) && f.fee_amount > 0 && f.fee_amount < 10_000_000 ? Math.round(f.fee_amount * 100) / 100 : null;
  return {
    is_contract: !!f.is_contract,
    creator_name: text(f.creator_name, 120),
    signed: !!f.signed,
    products,
    compensation_type: f.compensation_type ?? null,
    fee_amount: fee,
    terms: text(f.terms, 600),
    recipient_name: text(f.recipient_name, 120),
    address: text(f.address, 300),
  };
}

export type DealCurrent = Pick<
  CmPartnership,
  "agreementType" | "agreedTerms" | "compensationType" | "feeAmount" | "recipientName" | "addressLine1" | "addressLine2" | "city" | "region" | "postalCode"
> & { products: { productName: string; quantity: number }[] };

type CompensationType = NonNullable<CmPartnership["compensationType"]>;

export interface DealFill {
  agreementType?: "signed" | "verbal";
  agreedTerms?: string;
  feeAmount?: string;
  compensationType?: CompensationType;
  address?: ParsedAddress & { recipientName: string | null };
  products?: { productName: string; quantity: number }[];
}

const blank = (s: string | null | undefined) => !s || !s.trim();

export function hasAnyAddress(c: Pick<DealCurrent, "addressLine1" | "city" | "region" | "postalCode">): boolean {
  return !blank(c.addressLine1) || !blank(c.city) || !blank(c.region) || !blank(c.postalCode);
}

/** Pure: the address the facts give, only when it parses completely. */
export function factsAddress(f: Pick<DealFacts, "address" | "recipient_name">): (ParsedAddress & { recipientName: string | null }) | null {
  const parsed = parseAddress(f.address);
  if (!parsed?.isComplete) return null;
  return { ...parsed, recipientName: parsed.recipientName ?? f.recipient_name ?? null };
}

/**
 * Pure: what the facts may fill. Blank fields only; verbal → signed is the
 * one upgrade; products only when none are recorded; the address only when
 * none is on file and it parses completely (an incomplete one never fills).
 * `verbal`: the email shows an agreement, so a blank deal type becomes verbal.
 */
export function planDealFill(cur: DealCurrent, raw: DealFacts, opts: { verbal?: boolean } = {}): DealFill {
  const f = cleanFacts(raw);
  const fill: DealFill = {};
  if (f.signed && cur.agreementType !== "signed") fill.agreementType = "signed";
  else if (opts.verbal && !cur.agreementType) fill.agreementType = "verbal";
  if (blank(cur.agreedTerms) && f.terms) fill.agreedTerms = f.terms;
  if (cur.feeAmount == null && f.fee_amount != null) {
    fill.feeAmount = f.fee_amount.toFixed(2);
    // Compensation defaults to free product, so it's "blank" while there's no fee.
    if (!cur.compensationType || cur.compensationType === "free_product") fill.compensationType = f.compensation_type === "hybrid" ? "hybrid" : "flat_fee";
  }
  if (!hasAnyAddress(cur)) {
    const a = factsAddress(f);
    if (a) fill.address = a;
  }
  if (cur.products.length === 0 && f.products.length) fill.products = f.products.map((p) => ({ productName: p.name, quantity: p.quantity ?? 1 }));
  return fill;
}

/** Pure: plain words for what was filled — "signed deal, fee, address and 2 products". */
export function describeFill(fill: DealFill): string[] {
  const out: string[] = [];
  if (fill.agreementType === "signed") out.push("signed deal");
  if (fill.agreementType === "verbal") out.push("verbal deal");
  if (fill.feeAmount) out.push(`fee $${fill.feeAmount}`);
  if (fill.agreedTerms) out.push("terms");
  if (fill.address) out.push("address");
  if (fill.products?.length) out.push(fill.products.length === 1 ? `product (${fill.products[0].productName})` : `${fill.products.length} products`);
  return out;
}

export function listWords(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/* ── Differences: where the source disagrees with what's recorded ── */

export interface DealDifference {
  /** "field:value" — what "Keep mine" records, so the same offer isn't made again. */
  key: string;
  label: string;
  theirs: string;
  ours: string;
  /** "Use it" through the partnership PATCH… */
  patch?: Record<string, string | null>;
  /** …or by adding a product. */
  product?: { productName: string; quantity: number };
}

const money = (n: number | string) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const COMP_LABEL: Record<CompensationType, string> = { free_product: "Free product", flat_fee: "Flat fee", hybrid: "Product + fee" };

function sameProduct(a: string, b: string): boolean {
  const x = squash(a);
  const y = squash(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
}

/**
 * Pure: where the facts say something other than what's recorded. Blank
 * fields never appear here (they're filled). `terms`: only a contract's
 * terms are offered — an email's are a paraphrase and would always "differ".
 */
export function dealDifferences(cur: DealCurrent, raw: DealFacts, opts: { dismissed?: string[]; terms?: boolean } = {}): DealDifference[] {
  const f = cleanFacts(raw);
  const out: DealDifference[] = [];
  if (f.fee_amount != null && cur.feeAmount != null && Number(cur.feeAmount) !== f.fee_amount) {
    out.push({
      key: `fee:${f.fee_amount.toFixed(2)}`,
      label: "Fee",
      theirs: money(f.fee_amount),
      ours: money(cur.feeAmount),
      patch: { feeAmount: f.fee_amount.toFixed(2), compensationType: f.compensation_type === "hybrid" ? "hybrid" : cur.compensationType === "hybrid" ? "hybrid" : "flat_fee" },
    });
  } else if (f.fee_amount == null && f.compensation_type === "free_product" && cur.compensationType && cur.compensationType !== "free_product") {
    out.push({ key: "comp:free_product", label: "Compensation", theirs: COMP_LABEL.free_product, ours: COMP_LABEL[cur.compensationType], patch: { compensationType: "free_product", feeAmount: null } });
  }
  if (opts.terms && f.terms && !blank(cur.agreedTerms) && squash(f.terms) !== squash(cur.agreedTerms)) {
    out.push({ key: `terms:${squash(f.terms).slice(0, 80)}`, label: "Terms", theirs: f.terms, ours: cur.agreedTerms!, patch: { agreedTerms: f.terms } });
  }
  const a = factsAddress(f);
  if (a && hasAnyAddress(cur) && `${squash(a.addressLine1)} ${squash(a.postalCode)}` !== `${squash(cur.addressLine1)} ${squash(cur.postalCode)}`) {
    out.push({
      key: `address:${squash(a.addressLine1)} ${squash(a.postalCode)}`,
      label: "Address",
      theirs: [a.addressLine1, a.addressLine2, `${a.city}, ${a.region} ${a.postalCode}`].filter(Boolean).join(", "),
      ours: [cur.addressLine1, cur.addressLine2, [cur.city, cur.region].filter(Boolean).join(", "), cur.postalCode].filter((x) => !blank(x)).join(", "),
      patch: {
        ...(a.recipientName ? { recipientName: a.recipientName } : {}),
        addressLine1: a.addressLine1,
        addressLine2: a.addressLine2,
        city: a.city,
        region: a.region,
        postalCode: a.postalCode,
        country: a.country,
        addressRaw: a.raw,
      },
    });
  }
  if (cur.products.length) {
    for (const p of f.products) {
      if (cur.products.some((c) => sameProduct(c.productName, p.name))) continue;
      out.push({ key: `product:${squash(p.name)}`, label: "Product", theirs: `${p.name}${(p.quantity ?? 1) > 1 ? ` × ${p.quantity}` : ""}`, ours: "not listed", product: { productName: p.name, quantity: p.quantity ?? 1 } });
    }
  }
  const dismissed = new Set(opts.dismissed ?? []);
  return out.filter((d) => !dismissed.has(d.key));
}

/* ── Writing ────────────────────────────────────────────────────── */

export async function loadDealCurrent(partnershipId: string): Promise<(DealCurrent & { stage: CmPartnership["stage"] }) | null> {
  const [p] = await db.select().from(cmPartnerships).where(eq(cmPartnerships.id, partnershipId)).limit(1);
  if (!p) return null;
  const products = await db
    .select({ productName: cmProductsRequested.productName, quantity: cmProductsRequested.quantity })
    .from(cmProductsRequested)
    .where(eq(cmProductsRequested.partnershipId, partnershipId));
  return { ...p, products };
}

export interface ApplyDealFillResult {
  /** Plain words for what was actually filled (a hand edit made meanwhile wins, and isn't listed). */
  filled: string[];
  stageChanged: AutoStageResult | null;
}

/**
 * Fill blanks from the facts. Every column is guarded in SQL itself —
 * `case when <still blank> then new else old` — so a person's edit that
 * lands between the read and the write always wins. Leaves a timeline note
 * naming the source, and lets a now-complete address move Agreed → Ready to
 * ship through the rule table.
 */
export async function applyDealFill(
  partnershipId: string,
  facts: DealFacts,
  opts: {
    from: string;
    verbal?: boolean;
    userId?: string | null;
    /** false: a filled address doesn't move the stage (the email reader with automatic moves off). */
    stageMove?: boolean;
    /** Tests only: runs between the read and the write. */
    afterRead?: () => Promise<void>;
  },
): Promise<ApplyDealFillResult> {
  const cur = await loadDealCurrent(partnershipId);
  if (!cur) return { filled: [], stageChanged: null };
  const fill = planDealFill(cur, facts, { verbal: opts.verbal });
  await opts.afterRead?.();
  const P = cmPartnerships;
  const set: Record<string, unknown> = {};
  if (fill.agreementType === "signed") set.agreementType = sql`case when ${P.agreementType} is null or ${P.agreementType} = 'verbal' then 'signed'::cm_agreement_type else ${P.agreementType} end`;
  if (fill.agreementType === "verbal") set.agreementType = sql`coalesce(${P.agreementType}, 'verbal'::cm_agreement_type)`;
  if (fill.agreedTerms) set.agreedTerms = sql`case when nullif(trim(${P.agreedTerms}), '') is null then ${fill.agreedTerms}::text else ${P.agreedTerms} end`;
  if (fill.feeAmount) {
    set.feeAmount = sql`coalesce(${P.feeAmount}, ${fill.feeAmount}::numeric)`;
    if (fill.compensationType) {
      set.compensationType = sql`case when ${P.feeAmount} is null and (${P.compensationType} is null or ${P.compensationType} = 'free_product') then ${fill.compensationType}::cm_compensation_type else ${P.compensationType} end`;
    }
  }
  if (fill.address) {
    const a = fill.address;
    const noAddress = sql`coalesce(nullif(trim(${P.addressLine1}), ''), nullif(trim(${P.city}), ''), nullif(trim(${P.region}), ''), nullif(trim(${P.postalCode}), '')) is null`;
    const col = (c: AnyColumn, v: string | null) => sql`case when ${noAddress} then ${v}::text else ${c} end`;
    set.addressLine1 = col(P.addressLine1, a.addressLine1);
    set.addressLine2 = col(P.addressLine2, a.addressLine2);
    set.city = col(P.city, a.city);
    set.region = col(P.region, a.region);
    set.postalCode = col(P.postalCode, a.postalCode);
    set.country = col(P.country, a.country);
    set.addressRaw = col(P.addressRaw, a.raw);
    if (a.recipientName) set.recipientName = sql`case when ${noAddress} then coalesce(nullif(trim(${P.recipientName}), ''), ${a.recipientName}::text) else ${P.recipientName} end`;
  }

  const actual: DealFill = {};
  let after: Pick<CmPartnership, "addressLine1" | "city" | "region" | "postalCode"> | null = null;
  if (Object.keys(set).length) {
    const [row] = await db
      .update(P)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(P.id, partnershipId))
      .returning();
    if (!row) return { filled: [], stageChanged: null };
    after = row;
    if (fill.agreementType && row.agreementType === fill.agreementType && cur.agreementType !== fill.agreementType) actual.agreementType = fill.agreementType;
    if (fill.agreedTerms && row.agreedTerms === fill.agreedTerms) actual.agreedTerms = fill.agreedTerms;
    if (fill.feeAmount && cur.feeAmount == null && row.feeAmount != null && Number(row.feeAmount) === Number(fill.feeAmount)) actual.feeAmount = fill.feeAmount;
    if (fill.address && row.addressLine1 === fill.address.addressLine1 && row.postalCode === fill.address.postalCode) actual.address = fill.address;
  }
  if (fill.products?.length) {
    const values = sql.join(
      fill.products.map((p) => sql`(${p.productName}::text, ${p.quantity}::int)`),
      sql`, `,
    );
    const res = await db.execute(sql`
      insert into ${cmProductsRequested} (partnership_id, product_name, quantity)
      select ${partnershipId}::uuid, v.name, v.qty from (values ${values}) as v(name, qty)
      where not exists (select 1 from ${cmProductsRequested} where partnership_id = ${partnershipId}::uuid)
        -- Two fills at once: only the one holding this deal's lock inserts (the other adds nothing).
        and pg_try_advisory_xact_lock(hashtext('cm_products_fill:' || ${partnershipId}))
      returning id
    `);
    if ((res.rows ?? []).length) actual.products = fill.products;
  }

  const filled = describeFill(actual);
  if (filled.length) {
    await db.insert(cmOutreachEvents).values({
      partnershipId,
      direction: "outbound",
      channel: "other",
      kind: "note",
      body: `Filled in from ${opts.from}: ${listWords(filled)}.`,
      createdBy: opts.userId ?? null,
    });
  }
  let stageChanged: AutoStageResult | null = null;
  if (opts.stageMove !== false && actual.address && after && hasCompleteAddress(after)) {
    stageChanged = await applyAutoStage(partnershipId, "address_complete", opts.userId ?? undefined, { meta: { from: opts.from } });
  }
  // Finalizing leaves once the deal is signed and the address is in — whichever this fill supplied.
  if (opts.stageMove !== false && !stageChanged && (actual.address || actual.agreementType === "signed")) {
    stageChanged = await advanceIfDealReady(partnershipId, opts.userId ?? undefined, { from: opts.from });
  }
  return { filled, stageChanged };
}
