import { NextResponse, type NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/api-helpers";
import { runEmailCheck, SyncBusyError } from "@/lib/gmail-sync";

/**
 * POST /api/cron/email-sync — the scheduled check, driven by
 * scripts/cron-worker.ts with the CRON_SECRET bearer. Page visits keep email
 * fresh while the app is open; this covers the hours nobody has it open.
 * Every run leaves a cm_job_runs heartbeat; a partial check fails the job
 * visibly (its successful work is kept).
 */
export async function POST(req: NextRequest) {
  const authError = requireCronSecret(req);
  if (authError) return authError;

  try {
    const result = await runEmailCheck("cron", { requireComplete: true });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    if (err instanceof SyncBusyError) return NextResponse.json({ ok: true, skipped: "a check is already running" });
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
