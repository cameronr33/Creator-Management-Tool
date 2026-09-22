/**
 * Read-only diagnostic for "the email check ran but found nothing".
 *
 *   npm run gmail:diagnose
 *
 * Uses the connected Gmail account to answer, without writing anything:
 *   1. Does the stored refresh token still work?
 *   2. How many messages exist in the mailbox at all (last 7d) — proves API access.
 *   3. Per creator address: matches over 14d / 180d / 365d.
 * A creator address with 0 matches at 365d almost always means the address
 * saved in the app is not the one actually used in the conversation.
 * It never looks at anyone who isn't a creator in the app.
 */
import { decrypt } from "../src/lib/encryption";
import { refreshAccessToken, listMessageIds } from "../src/lib/gmail";
import { getActiveGmailAccount } from "../src/lib/gmail-sync";
import { getEmailRoster } from "../src/lib/email-ingest";

async function count(token: string, q: string): Promise<string> {
  const r = await listMessageIds(token, q, 500);
  return `${r.ids.length}${r.truncated ? "+" : ""}`;
}

async function main() {
  const account = await getActiveGmailAccount();
  if (!account) {
    console.log("No active Gmail account — connect one in Settings.");
    return;
  }
  console.log(`Connected mailbox: ${account.email}`);
  console.log(`Last check: ${account.lastSyncAt?.toISOString() ?? "never"} (${account.lastSyncStatus ?? "-"})`);
  console.log(`Checked through: ${account.syncedThrough?.toISOString() ?? "no complete check yet"}`);

  const token = await refreshAccessToken(decrypt(account.refreshTokenEnc));
  console.log("Refresh token: OK\n");
  console.log(`Mailbox activity, last 7d: ${await count(token, "newer_than:7d")} messages\n`);

  const roster = await getEmailRoster();
  console.log(`Roster: ${roster.length} creator(s) with an email address`);
  for (const c of roster) {
    for (const a of c.addresses) {
      const base = `(from:"${a}" OR to:"${a}" OR cc:"${a}")`;
      const [d14, d180, d365] = await Promise.all([
        count(token, `${base} newer_than:14d`),
        count(token, `${base} newer_than:180d`),
        count(token, `${base} newer_than:365d`),
      ]);
      console.log(`  ${c.name.padEnd(28)} ${a.padEnd(36)} 14d=${d14} 180d=${d180} 365d=${d365}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
