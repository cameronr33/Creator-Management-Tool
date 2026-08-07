import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth, badRequest } from "@/lib/api-helpers";
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
  feeAmount: z.union([z.number(), z.string()]).nullable().optional(),
  briefUrl: z.string().nullable().optional(),
  briefSentAt: z.string().nullable().optional(),
  exitReason: z.enum(cmExitReasonEnum.enumValues).nullable().optional(),
  notes: z.string().nullable().optional(),
  recipientName: z.string().nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid fields", parsed.error.flatten());

  const data = parsed.data;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (k === "feeAmount") update[k] = v === null || v === "" ? null : String(v);
    else if (k === "briefSentAt") update[k] = v ? new Date(v as string) : null;
    else update[k] = v;
  }

  await db.update(cmPartnerships).set(update).where(eq(cmPartnerships.id, id));
  return NextResponse.json({ ok: true });
}
