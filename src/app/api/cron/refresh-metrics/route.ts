import { NextResponse, type NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/api-helpers";
import { refreshCreatorMetrics } from "@/lib/refresh";
import { runJob } from "@/lib/job-runs";

/**
 * TIER 1 weekly metric refresh (followers only — see src/lib/refresh.ts for why
 * view counts are deliberately excluded). Called by the Railway cron worker.
 * Leaves a cm_job_runs heartbeat; "idle" when nothing was stale.
 */
export async function POST(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const clientId = typeof body?.clientId === "string" ? body.clientId : undefined;

  try {
    const outcome = await runJob("refresh_metrics", async () => {
      const result = await refreshCreatorMetrics({ clientId });
      return { status: result.candidates === 0 ? "idle" : "ok", summary: result };
    });
    return NextResponse.json({ ok: true, ...outcome.summary, status: outcome.status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
