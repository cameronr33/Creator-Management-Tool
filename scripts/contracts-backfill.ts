/**
 * One-off (2026-09-24): contract PDFs on email stored before attachments were
 * looked at. Re-fetches each stored email, records its PDF attachments
 * (never a stranger's on the thread), downloads them, then reads them — blank
 * deal fields fill in; nothing already filled is replaced.
 *
 *   npm run contracts:backfill            # dry run: lists what it would record
 *   npm run contracts:backfill -- --apply
 */
import { recordStoredAttachments } from "../src/lib/gmail-sync";
import { readPendingContracts } from "../src/lib/contracts";

async function main() {
  const apply = process.argv.includes("--apply");
  const r = await recordStoredAttachments({ apply });
  console.log(`Checked ${r.messages} stored emails (${r.errors} couldn't be fetched).`);
  console.log(`${r.pdfs.length} PDF attachment(s):`);
  for (const p of r.pdfs) console.log(`  ${p.partnershipId}  ${p.filename}`);
  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply.");
    return;
  }
  let total = { read: 0, failed: 0 };
  for (let i = 0; i < 20; i++) {
    const r2 = await readPendingContracts({ limit: 10 });
    total = { read: total.read + r2.read, failed: total.failed + r2.failed };
    if (r2.read + r2.failed === 0) break;
  }
  console.log(`\nRead ${total.read} file(s); ${total.failed} couldn't be read (see the Deal card).`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
