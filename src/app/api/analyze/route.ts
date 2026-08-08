import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { requireAuth, badRequest } from "@/lib/api-helpers";
import {
  requestFullAnalysis,
  runQuickAnalysisInBackground,
  getLatestRequestForPartnership,
} from "@/lib/research-requests";

const postSchema = z.object({ partnershipId: z.string().uuid() });

/**
 * "Full Analysis" button.
 *
 * POST creates (or reuses) a research request and responds immediately;
 * the instant Apify-only pass runs via `after()` so the click doesn't block
 * on a ~30-90s Apify round trip. GET polls status for the UI chip.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid request", parsed.error.flatten());

  try {
    const { request, created } = await requestFullAnalysis(
      parsed.data.partnershipId,
      session.user.id,
    );
    // Schedule the ~30-90s Apify round trip to run after the response is
    // sent, rather than awaiting it — the click returns immediately and the
    // UI's status poll picks up quickPassAt once it lands. Only for a freshly
    // created request; re-clicking onto an existing open one doesn't re-fire it.
    if (created) {
      after(() => runQuickAnalysisInBackground(request.id));
    }
    return NextResponse.json({ ok: true, request, created });
  } catch (e) {
    return badRequest((e as Error).message);
  }
}

export async function GET(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const partnershipId = req.nextUrl.searchParams.get("partnershipId");
  if (!partnershipId) return badRequest("Missing partnershipId");

  const request = await getLatestRequestForPartnership(partnershipId);
  return NextResponse.json({ ok: true, request });
}
