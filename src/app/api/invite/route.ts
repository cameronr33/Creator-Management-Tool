import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { badRequest } from "@/lib/api-helpers";
import { acceptInvite, MIN_PASSWORD } from "@/lib/client-users";

/**
 * POST /api/invite { token, password } — the one public route besides sign-in.
 * Its guard is the invite itself: a one-time, expiring token that only ever
 * sets the password of the person it was made for (acceptInvite).
 */
export async function POST(req: NextRequest) {
  const parsed = z.object({ token: z.string().min(20).max(100), password: z.string().min(MIN_PASSWORD).max(200) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(`Choose a password of at least ${MIN_PASSWORD} characters`);
  const r = await acceptInvite(parsed.data.token, parsed.data.password);
  if (!r.ok) return badRequest(r.error);
  return NextResponse.json({ ok: true, email: r.email });
}
