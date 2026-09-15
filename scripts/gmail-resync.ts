/**
 * Re-run the Gmail sync over a wider window. Already-captured messages are
 * refreshed in place (cleaned body, from/to) — direction, kind and pipeline
 * stage are never changed by a re-sync.
 *
 *   npm run gmail:resync            # 90 days
 *   npm run gmail:resync -- 180     # custom window
 */
import { runGmailSync } from "../src/lib/gmail-sync";

async function main() {
  const days = Number(process.argv[2] ?? 90);
  const r = await runGmailSync({ windowDays: days });
  console.log(
    `window ${r.windowDays}d · ${r.messagesFetched} messages · ${r.inserted} new · ${r.skipped} refreshed · ${r.suggestionsOpen} unmatched senders`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
