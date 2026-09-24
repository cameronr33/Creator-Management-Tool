import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireAgency, badRequest, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { httpUrl } from "@/lib/validation";
import { db } from "@/lib/db";
import { cmProductsRequested, cmPartnerships, cmCreators } from "@/lib/db/schema";
import { resolveClient } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";

const createSchema = z.object({
  partnershipId: z.string().uuid(),
  productName: z.string().min(1),
  productUrl: httpUrl.nullable().optional().or(z.literal("")),
  category: z.string().nullable().optional(),
  quantity: z.number().int().min(1).default(1),
  notes: z.string().nullable().optional(),
});

const deleteSchema = z.object({ id: z.string().uuid() });

export async function POST(req: NextRequest) {
  const { error } = await requireAgency();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid product", parsed.error.flatten());
  const d = parsed.data;

  const scope = await assertPartnershipInSelectedClient(d.partnershipId);
  if (scope) return scope;

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
  const { error } = await requireAgency();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return badRequest("Missing id");

  // Delete only within the selected client — a product id from another
  // client's deal must not be removable from here.
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) return badRequest("No client selected");
  const [owner] = await db
    .select({ clientId: cmCreators.clientId })
    .from(cmProductsRequested)
    .innerJoin(cmPartnerships, eq(cmProductsRequested.partnershipId, cmPartnerships.id))
    .innerJoin(cmCreators, eq(cmPartnerships.creatorId, cmCreators.id))
    .where(eq(cmProductsRequested.id, parsed.data.id))
    .limit(1);
  if (!owner || owner.clientId !== client.id) return badRequest("Product not found");

  await db
    .delete(cmProductsRequested)
    .where(and(eq(cmProductsRequested.id, parsed.data.id)));
  return NextResponse.json({ ok: true });
}
