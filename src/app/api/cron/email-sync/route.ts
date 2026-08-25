import { NextResponse, type NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/api-helpers";
import { getActiveGmailAccount, runGmailSync } from "@/lib/gmail-sync";

/**
 * POST /api/cron/email-sync — the twice-daily automatic sync, driven by
 * scripts/cron-worker.ts with the CRON_SECRET bearer. No connected account
 * is a clean no-op, not an error, so the cron stays quiet until someone
 * connects a mailbox in Settings.
 */
export async function POST(req: NextRequest) {
  const authError = requireCronSecret(req);
  if (authError) return authError;

  const account = await getActiveGmailAccount();
  if (!account) {
    return NextResponse.json({ ok: true, skipped: "no Gmail account connected" });
  }

  try {
    const result = await runGmailSync();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
