import { after } from "next/server";
import { getActiveGmailAccount } from "@/lib/gmail-sync";
import { loadTeamIdentity, reclassifyStoredEmails } from "@/lib/email-ingest";

/** After the response: re-decide who wrote each stored email (a client's people or domains changed). */
export function reclassifyLater() {
  after(async () => {
    const account = await getActiveGmailAccount();
    if (account) await reclassifyStoredEmails(await loadTeamIdentity(account.email, account.teamAddresses ?? []));
  });
}
