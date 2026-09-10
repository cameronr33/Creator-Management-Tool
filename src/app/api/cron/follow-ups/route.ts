import { NextResponse, type NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/api-helpers";
import { runFollowUpSweep } from "@/lib/alerts";
import { runJob } from "@/lib/job-runs";

/** Daily follow-up sweep. Called by the Railway cron worker (or manually). */
export async function POST(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const clientId = typeof body?.clientId === "string" ? body.clientId : undefined;

  try {
    const outcome = await runJob("follow_ups", async () => {
      const result = await runFollowUpSweep(clientId);
      return { status: result.scanned === 0 ? "idle" : "ok", summary: result };
    });
    return NextResponse.json({ ok: true, ...outcome.summary, status: outcome.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sweep failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
