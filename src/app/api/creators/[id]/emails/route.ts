import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAgency, badRequest, errorResponse, assertCreatorInSelectedClient } from "@/lib/api-helpers";
import { addCreatorEmail, removeCreatorEmail } from "@/lib/creator-emails";
import { checkEmailForNewAddress } from "@/lib/gmail-sync";

const schema = z.object({ email: z.string().min(3) });

/** POST /api/creators/[id]/emails — add an address the creator uses. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAgency();
  if (error) return error;

  const { id } = await ctx.params;
  const scope = await assertCreatorInSelectedClient(id);
  if (scope) return scope;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("That doesn't look like an email address. Check it and try again.", parsed.error.flatten());

  try {
    const email = await addCreatorEmail(id, parsed.data.email);
    // Search this address's last 180 days now rather than at the next visit.
    after(() => checkEmailForNewAddress());
    return NextResponse.json({ ok: true, email });
  } catch (e) {
    return errorResponse(e, "Couldn't add that email. Try again in a moment.");
  }
}

/** DELETE /api/creators/[id]/emails — remove an address. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAgency();
  if (error) return error;

  const { id } = await ctx.params;
  const scope = await assertCreatorInSelectedClient(id);
  if (scope) return scope;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("That doesn't look like an email address. Check it and try again.");

  await removeCreatorEmail(id, parsed.data.email);
  return NextResponse.json({ ok: true });
}
