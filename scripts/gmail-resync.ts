/**
 * Maintenance for the email check.
 *
 *   npm run gmail:resync -- --refresh --dry-run   # show how stored emails would be re-labelled
 *   npm run gmail:resync -- --refresh --apply     # re-download stored emails and re-label them
 *   npm run gmail:resync -- 365                   # search every creator address over 365 days
 *
 * --refresh rebuilds how each stored email is recorded (body, cc, Message-ID,
 * who sent it, invites and auto-replies as notes) and re-sequences
 * first message / reply / follow-up. It never moves an email to another
 * partnership and never changes a stage.
 */
import { refreshStoredEmails, runGmailSync } from "../src/lib/gmail-sync";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--refresh")) {
    const apply = args.includes("--apply");
    if (!apply && !args.includes("--dry-run")) throw new Error("With --refresh, pass --dry-run or --apply");
    const r = await refreshStoredEmails({ apply });
    console.log(`${r.checked} stored email(s) re-read${r.errors ? `, ${r.errors} could not be downloaded` : ""}${apply ? "" : " (dry run — nothing written)"}`);
    for (const c of r.changes) {
      console.log(`  ${c.subject ?? "(no subject)"}: ${c.before.direction}/${c.before.kind} → ${c.after.direction}/${c.after.kind}`);
    }
    if (apply) console.log("Kinds re-sequenced for every touched conversation.");
    return;
  }
  const days = Number(args[0] ?? 180);
  if (!Number.isFinite(days) || days <= 0) throw new Error("Pass a number of days, or --refresh");
  const r = await runGmailSync({ trigger: "resync", windowDays: days });
  console.log(
    `${days}d · ${r.rosterSize} address(es) · ${r.messagesFetched} downloaded · ${r.inserted} new · ${r.skipped} already stored · ${r.unmatched} not a creator's${r.fetchErrors ? ` · ${r.fetchErrors} failed` : ""}${r.truncated ? " · capped" : ""}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
