import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAgency, badRequest } from "@/lib/api-helpers";
import { markCreatorSide, unmarkCreatorSide } from "@/lib/client-domains";

/**
 * POST /api/thread-senders — Settings → client team → "Who are these?":
 *   { email }              they're with the creator (a manager, a parent), not the brand
 *   { email, undo: true }  Undo
 * Their threads are read again so the email reader sees whose side they're on.
 */
const schema = z.object({ email: z.string().trim().toLowerCase().regex(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/), undo: z.boolean().optional() });

export async function POST(req: NextRequest) {
  const { error } = await requireAgency();
  if (error) return error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Couldn't save that. Reload the page and try again.");
  if (parsed.data.undo) {
    await unmarkCreatorSide(parsed.data.email);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: true, email: await markCreatorSide(parsed.data.email) });
}
