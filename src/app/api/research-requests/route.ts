import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey } from "@/lib/api-helpers";
import { listQueuedRequests } from "@/lib/research-requests";

/**
 * Queue listing for the local runner (queue_client.py in the creator-research
 * skill). Only `queued` requests — the runner claims one via PATCH before
 * starting the real skill run.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireApiKey(req);
  if (error) return error;

  const requests = await listQueuedRequests();
  return NextResponse.json({ ok: true, requests });
}
