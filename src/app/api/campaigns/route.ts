import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireAuth, badRequest } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { cmCampaigns } from "@/lib/db/schema";

const schema = z.object({
  clientId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid campaign", parsed.error.flatten());
  const d = parsed.data;

  const [existing] = await db
    .select({ id: cmCampaigns.id })
    .from(cmCampaigns)
    .where(and(eq(cmCampaigns.clientId, d.clientId), eq(cmCampaigns.name, d.name)))
    .limit(1);
  if (existing) return badRequest("A campaign with that name already exists");

  const [row] = await db
    .insert(cmCampaigns)
    .values({ clientId: d.clientId, name: d.name, description: d.description ?? null })
    .returning({ id: cmCampaigns.id });

  return NextResponse.json({ ok: true, id: row.id });
}
