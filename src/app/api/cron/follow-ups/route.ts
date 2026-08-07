import { NextResponse, type NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/api-helpers";
import { runFollowUpSweep } from "@/lib/alerts";

/** Daily follow-up sweep. Called by the Railway cron worker (or manually). */
export async function POST(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const clientId = typeof body?.clientId === "string" ? body.clientId : undefined;

  const result = await runFollowUpSweep(clientId);
  return NextResponse.json({ ok: true, ...result });
}
