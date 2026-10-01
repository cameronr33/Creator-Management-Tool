import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAgency, badRequest } from "@/lib/api-helpers";
import { resolveClient } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { addClientDomain, removeClientDomain } from "@/lib/client-domains";
import { reclassifyLater } from "@/lib/reclassify-later";

/**
 * Settings → client team → whole domains, for the client selected in the sidebar.
 *   POST   { domain }  everyone at it counts as the client's on their creators
 *   DELETE { id }      take it off
 * Either re-decides who wrote each stored email.
 */
export async function POST(req: NextRequest) {
  const { error } = await requireAgency();
  if (error) return error;
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) return badRequest("Pick a client in the sidebar first.");
  const parsed = z.object({ domain: z.string().max(200) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Type a domain, like partner.com, then try again.");
  const r = await addClientDomain(client.id, parsed.data.domain);
  if (!r.ok) return badRequest(r.error);
  reclassifyLater();
  return NextResponse.json({ ok: true, id: r.id, domain: r.domain });
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAgency();
  if (error) return error;
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) return badRequest("Pick a client in the sidebar first.");
  const parsed = z.object({ id: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Couldn't remove that domain. Reload the page and try again.");
  if (!(await removeClientDomain(client.id, parsed.data.id))) return badRequest("That domain isn't on this client any more. Reload the page.");
  reclassifyLater();
  return NextResponse.json({ ok: true });
}
