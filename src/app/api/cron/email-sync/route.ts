import { NextResponse, type NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/api-helpers";
import { getActiveGmailAccount, runGmailSync } from "@/lib/gmail-sync";
import { runJob } from "@/lib/job-runs";
import { requireCompleteSync } from "@/lib/gmail-sync-outcome";

/**
 * POST /api/cron/email-sync — the twice-daily automatic sync, driven by
 * scripts/cron-worker.ts with the CRON_SECRET bearer. Every run leaves a
 * cm_job_runs heartbeat: "idle" when no mailbox is connected (healthy but
 * inert — and visibly so in Settings), "ok" after a real pass, "error" on
 * failure.
 */
export async function POST(req: NextRequest) {
  const authError = requireCronSecret(req);
  if (authError) return authError;

  try {
    const outcome = await runJob("email_sync", async () => {
      const account = await getActiveGmailAccount();
      if (!account) return { status: "idle", summary: { skipped: "no Gmail account connected" } };
      const result = await runGmailSync();
      // The account retains its partial summary; the worker must see a failed run.
      requireCompleteSync(result);
      return {
        status: result.rosterSize === 0 ? "idle" : "ok",
        summary: {
          windowDays: result.windowDays,
          rosterSize: result.rosterSize,
          messagesFetched: result.messagesFetched,
          fetchErrors: result.fetchErrors,
          inserted: result.inserted,
          skipped: result.skipped,
          unmatched: result.unmatched.length,
          stageChanges: result.stageChanges.length,
          suggestionsOpen: result.suggestionsOpen,
        },
      };
    });
    return NextResponse.json({ ok: true, ...outcome });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
