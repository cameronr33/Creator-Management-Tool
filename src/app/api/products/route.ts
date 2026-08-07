import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth, badRequest } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { cmProductsRequested } from "@/lib/db/schema";

const createSchema = z.object({
  partnershipId: z.string().uuid(),
  productName: z.string().min(1),
  productUrl: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  quantity: z.number().int().min(1).default(1),
  notes: z.string().nullable().optional(),
});

const deleteSchema = z.object({ id: z.string().uuid() });

export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid product", parsed.error.flatten());
  const d = parsed.data;

  const [row] = await db
    .insert(cmProductsRequested)
    .values({
      partnershipId: d.partnershipId,
      productName: d.productName,
      productUrl: d.productUrl || null,
      category: d.category || null,
      quantity: d.quantity,
      notes: d.notes || null,
    })
    .returning({ id: cmProductsRequested.id });

  return NextResponse.json({ ok: true, id: row.id });
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return badRequest("Missing id");

  await db.delete(cmProductsRequested).where(eq(cmProductsRequested.id, parsed.data.id));
  return NextResponse.json({ ok: true });
}
