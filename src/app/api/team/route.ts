import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAgency, badRequest } from "@/lib/api-helpers";
import { addTeammate, updateTeammate } from "@/lib/owners";

const addSchema = z.object({ name: z.string().max(120), email: z.string().max(200).nullable().optional() });
const editSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(120).optional(),
  email: z.string().max(200).nullable().optional(),
  active: z.boolean().optional(),
});

/** POST /api/team — add a teammate to the team list (Settings → Team). */
export async function POST(req: NextRequest) {
  const { error } = await requireAgency();
  if (error) return error;
  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Couldn't add them. Check the name and email, then try again.");
  const r = await addTeammate(parsed.data);
  if (!r.ok) return badRequest(r.error);
  return NextResponse.json({ ok: true, id: r.id });
}

/** PATCH /api/team — rename a teammate, change their email, or switch them off / on. */
export async function PATCH(req: NextRequest) {
  const { error } = await requireAgency();
  if (error) return error;
  const parsed = editSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Couldn't save that change. Reload the page and try again.");
  const { id, ...rest } = parsed.data;
  const r = await updateTeammate(id, rest);
  if (!r.ok) return badRequest(r.error);
  return NextResponse.json({ ok: true });
}
