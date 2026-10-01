import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAgency, badRequest } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { cmGmailAccounts } from "@/lib/db/schema";
import { getActiveGmailAccount } from "@/lib/gmail-sync";
import { FREE_MAIL_DOMAINS, loadTeamIdentity, reclassifyStoredEmails } from "@/lib/email-ingest";
import { clientDomainClash } from "@/lib/client-domains";

const entry = z
  .string()
  .trim()
  .toLowerCase()
  .refine((e) => /^@[^\s@]+\.[^\s@]+$/.test(e) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e), { message: "Use an address or @domain.com" })
  .refine((e) => !(e.startsWith("@") && FREE_MAIL_DOMAINS.has(e.slice(1))), { message: "A free-mail domain can't be a whole team — add the address instead" });

const schema = z.object({ entries: z.array(entry).max(200) });

/**
 * PUT /api/gmail/team — the "Our side" list: teammates or client staff who
 * email creators from other addresses. Saving it re-decides who wrote each
 * stored email (from saved headers, nothing downloaded).
 */
export async function PUT(req: NextRequest) {
  const { error } = await requireAgency();
  if (error) return error;
  const account = await getActiveGmailAccount();
  if (!account) return badRequest("Connect the mailbox first");

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Couldn't save the list. Check the addresses and try again.", parsed.error.flatten());

  const entries = [...new Set(parsed.data.entries)];
  const clash = await clientDomainClash(entries);
  if (clash) return badRequest(`@${clash.domain} is on ${clash.clientName}'s team. Take it off there first (Settings → ${clash.clientName}'s team).`);
  await db.update(cmGmailAccounts).set({ teamAddresses: entries }).where(eq(cmGmailAccounts.id, account.id));
  after(async () => {
    await reclassifyStoredEmails(await loadTeamIdentity(account.email, entries));
  });
  return NextResponse.json({ ok: true, entries });
}
