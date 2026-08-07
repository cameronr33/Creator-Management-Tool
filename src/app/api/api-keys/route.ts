import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth, badRequest, hashApiKey } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { cmApiKeys } from "@/lib/db/schema";

const createSchema = z.object({ name: z.string().min(1) });
const revokeSchema = z.object({ id: z.string().uuid() });

export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return badRequest("Missing name");

  // Raw key shown exactly once; only its hash is stored.
  const raw = `cm_${randomBytes(24).toString("hex")}`;
  const [row] = await db
    .insert(cmApiKeys)
    .values({
      name: parsed.data.name,
      keyHash: hashApiKey(raw),
      keyPrefix: raw.slice(0, 10),
      createdBy: session.user.id,
    })
    .returning({ id: cmApiKeys.id });

  return NextResponse.json({ ok: true, id: row.id, key: raw });
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = revokeSchema.safeParse(body);
  if (!parsed.success) return badRequest("Missing id");

  await db.update(cmApiKeys).set({ revokedAt: new Date() }).where(eq(cmApiKeys.id, parsed.data.id));
  return NextResponse.json({ ok: true });
}
