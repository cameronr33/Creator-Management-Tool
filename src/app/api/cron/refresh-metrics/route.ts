import { NextResponse, type NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/api-helpers";
import { refreshCreatorMetrics } from "@/lib/refresh";

/**
 * TIER 1 weekly metric refresh (followers only — see src/lib/refresh.ts for why
 * view counts are deliberately excluded). Called by the Railway cron worker.
 */
export async function POST(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const clientId = typeof body?.clientId === "string" ? body.clientId : undefined;

  try {
    const result = await refreshCreatorMetrics({ clientId });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
