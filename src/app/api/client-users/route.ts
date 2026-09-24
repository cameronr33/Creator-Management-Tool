import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAgency, badRequest } from "@/lib/api-helpers";
import { resolveClient } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { addClientUser, createInvite, removeClientUser, revokeLogin } from "@/lib/client-users";
import { getActiveGmailAccount } from "@/lib/gmail-sync";
import { loadTeamIdentity, reclassifyStoredEmails } from "@/lib/email-ingest";

/**
 * Settings → Client team, for the client selected in the sidebar.
 *   POST   { name, email }                  add a person (a client contact for email)
 *   PATCH  { id, action: "invite"|"revoke" } a one-time login link, or turn their login off
 *   DELETE { id }                           remove them
 * Adding or removing someone re-decides who wrote each stored email.
 */

async function selectedClient() {
  return resolveClient(await getSelectedClientSlug());
}

function reclassifyLater() {
  after(async () => {
    const account = await getActiveGmailAccount();
    if (account) await reclassifyStoredEmails(await loadTeamIdentity(account.email, account.teamAddresses ?? []));
  });
}

export async function POST(req: NextRequest) {
  const { error } = await requireAgency();
  if (error) return error;
  const client = await selectedClient();
  if (!client) return badRequest("Pick a client in the sidebar first");
  const parsed = z.object({ name: z.string().max(120), email: z.string().max(200) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Add a name and an email address");
  const r = await addClientUser(client.id, parsed.data.name, parsed.data.email);
  if (!r.ok) return badRequest(r.error);
  reclassifyLater();
  return NextResponse.json({ ok: true, id: r.id });
}

export async function PATCH(req: NextRequest) {
  const { error } = await requireAgency();
  if (error) return error;
  const client = await selectedClient();
  if (!client) return badRequest("Pick a client in the sidebar first");
  const parsed = z.object({ id: z.string().uuid(), action: z.enum(["invite", "revoke"]) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid request");
  if (parsed.data.action === "revoke") {
    return (await revokeLogin(client.id, parsed.data.id)) ? NextResponse.json({ ok: true }) : badRequest("Person not found for this client");
  }
  const token = await createInvite(client.id, parsed.data.id);
  if (!token) return badRequest("Person not found for this client");
  const base = (process.env.APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");
  return NextResponse.json({ ok: true, url: `${base}/invite/${token}` });
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAgency();
  if (error) return error;
  const client = await selectedClient();
  if (!client) return badRequest("Pick a client in the sidebar first");
  const parsed = z.object({ id: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid request");
  if (!(await removeClientUser(client.id, parsed.data.id))) return badRequest("Person not found for this client");
  reclassifyLater();
  return NextResponse.json({ ok: true });
}
