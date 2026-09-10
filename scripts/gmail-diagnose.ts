/**
 * Read-only diagnostic for "the email sync ran but found nothing".
 *
 *   npm run gmail:diagnose
 *
 * Uses the connected Gmail account to answer, without writing anything:
 *   1. Does the stored refresh token still work?
 *   2. How many messages exist in the mailbox at all (last 7d) — proves API access.
 *   3. How many cc'd threads exist (cc:<connected mailbox>) over 90d/365d.
 *   4. Per roster address: matches over 14d / 90d / 365d.
 * A roster address with 0 matches at 365d almost always means the creator's
 * businessEmail in the app is not the address actually used in the thread.
 */
import { decrypt } from "../src/lib/encryption";
import { refreshAccessToken, listMessageIds } from "../src/lib/gmail";
import { getActiveGmailAccount } from "../src/lib/gmail-sync";
import { getEmailRoster } from "../src/lib/email-ingest";

async function count(token: string, q: string): Promise<number> {
  return (await listMessageIds(token, q, 500)).length;
}

async function main() {
  const account = await getActiveGmailAccount();
  if (!account) {
    console.log("No active Gmail account — connect one in Settings.");
    return;
  }
  console.log(`Connected mailbox: ${account.email}`);
  console.log(`Last sync: ${account.lastSyncAt?.toISOString() ?? "never"} (${account.lastSyncStatus ?? "-"})`);

  const token = await refreshAccessToken(decrypt(account.refreshTokenEnc));
  console.log("Refresh token: OK\n");

  console.log(`Mailbox activity, last 7d:      ${await count(token, "newer_than:7d")} messages`);
  console.log(`cc:${account.email}, last 90d:   ${await count(token, `cc:${account.email} newer_than:90d`)} messages`);
  console.log(`cc:${account.email}, last 365d:  ${await count(token, `cc:${account.email} newer_than:365d`)} messages\n`);

  const roster = await getEmailRoster();
  console.log(`Roster: ${roster.length} creator(s) with a business email and an open partnership`);
  for (const c of roster) {
    const base = `(from:${c.businessEmail} OR to:${c.businessEmail} OR cc:${c.businessEmail})`;
    const [d14, d90, d365] = await Promise.all([
      count(token, `${base} newer_than:14d`),
      count(token, `${base} newer_than:90d`),
      count(token, `${base} newer_than:365d`),
    ]);
    console.log(
      `  ${c.name.padEnd(28)} ${c.businessEmail.padEnd(36)} stage=${c.stage.padEnd(16)} 14d=${d14} 90d=${d90} 365d=${d365}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
