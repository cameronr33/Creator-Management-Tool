import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { requireAgency, badRequest, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { httpUrl, isoDate, money } from "@/lib/validation";
import { advanceIfDealReady, applyAutoStage } from "@/lib/auto-stage";
import { hasCompleteAddress } from "@/lib/address";
import { db } from "@/lib/db";
import {
  cmPartnerships,
  cmAgreementTypeEnum,
  cmCompensationTypeEnum,
  cmExitReasonEnum,
} from "@/lib/db/schema";

const schema = z.object({
  agreementType: z.enum(cmAgreementTypeEnum.enumValues).nullable().optional(),
  agreedTerms: z.string().nullable().optional(),
  compensationType: z.enum(cmCompensationTypeEnum.enumValues).optional(),
  feeAmount: money.nullable().optional().or(z.literal("")),
  briefUrl: httpUrl.nullable().optional().or(z.literal("")),
  briefSentAt: isoDate.nullable().optional(),
  exitReason: z.enum(cmExitReasonEnum.enumValues).nullable().optional(),
  notes: z.string().nullable().optional(),
  recipientName: z.string().nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  addressRaw: z.string().nullable().optional(),
  outreachReason: z.string().nullable().optional(),
  /** Our own note on where things stand; "" or null clears it. */
  statusNote: z.string().max(600).nullable().optional(),
  /** "Keep mine" on a contract/email difference: that "field:value" isn't offered again. */
  dismissDeal: z.string().min(1).max(200).optional(),
});

const ADDRESS_KEYS = [
  "recipientName",
  "addressLine1",
  "addressLine2",
  "city",
  "region",
  "postalCode",
  "country",
  "addressRaw",
] as const;

const DEAL_KEYS = ["agreementType", "agreedTerms", "compensationType", "feeAmount", ...ADDRESS_KEYS] as const;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAgency();
  if (error) return error;

  const { id } = await ctx.params;
  const scope = await assertPartnershipInSelectedClient(id);
  if (scope) return scope;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid fields", parsed.error.flatten());

  const data = parsed.data;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (k === "statusNote") {
      const note = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
      update.statusNote = note || null;
      update.statusNoteAt = note ? new Date() : null;
      update.statusNoteBy = note ? session.user.name || session.user.email || null : null;
      continue;
    }
    if (k === "dismissDeal") {
      update.dealDismissed = sql`coalesce(${cmPartnerships.dealDismissed}, '[]'::jsonb) || ${JSON.stringify([v])}::jsonb`;
      continue;
    }
    if (k === "feeAmount") update[k] = v === null || v === "" ? null : String(v);
    else if (k === "briefUrl") update[k] = v === "" ? null : v;
    else if (k === "briefSentAt") update[k] = v ? new Date(v as string) : null;
    else update[k] = v;
  }

  // A person decided the deal: email fills only from mail newer than this (a cleared field stays cleared).
  if (DEAL_KEYS.some((k) => data[k] !== undefined)) update.dealEditedAt = new Date();

  await db.update(cmPartnerships).set(update).where(eq(cmPartnerships.id, id));

  // If the payload touched the address and the row now holds a complete one,
  // an awaiting_address partnership advances to fulfilling automatically.
  let stageChanged = null;
  if (ADDRESS_KEYS.some((k) => data[k] !== undefined)) {
    const [row] = await db
      .select({
        addressLine1: cmPartnerships.addressLine1,
        city: cmPartnerships.city,
        region: cmPartnerships.region,
        postalCode: cmPartnerships.postalCode,
      })
      .from(cmPartnerships)
      .where(eq(cmPartnerships.id, id))
      .limit(1);
    if (row && hasCompleteAddress(row)) {
      stageChanged = await applyAutoStage(id, "address_complete", session.user.id);
    }
  }
  // Finalizing → Ready to ship once the deal is signed and the address is in (either may arrive last).
  if (!stageChanged && (data.agreementType !== undefined || ADDRESS_KEYS.some((k) => data[k] !== undefined))) {
    stageChanged = await advanceIfDealReady(id, session.user.id);
  }

  return NextResponse.json({ ok: true, stageChanged });
}
