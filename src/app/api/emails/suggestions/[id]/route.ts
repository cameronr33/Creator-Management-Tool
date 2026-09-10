import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, badRequest } from "@/lib/api-helpers";
import { linkSuggestion, ignoreSuggestion } from "@/lib/email-suggestions";
import { syncCreatorNow } from "@/lib/gmail-sync";

/**
 * POST /api/emails/suggestions/[id] — resolve a discovered address.
 *   { action: "link", creatorId }  → cm_creator_emails row + immediate sync
 *   { action: "ignore" }           → hide it
 */
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link"), creatorId: z.string().uuid() }),
  z.object({ action: z.literal("ignore") }),
]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid action", parsed.error.flatten());

  if (parsed.data.action === "ignore") {
    const ok = await ignoreSuggestion(id);
    return ok ? NextResponse.json({ ok: true }) : badRequest("Suggestion not found or not open");
  }

  const linked = await linkSuggestion(id, parsed.data.creatorId);
  if (!linked) return badRequest("Suggestion not found");

  // Pull this creator's threads now so the link pays off immediately.
  let synced = null;
  try {
    synced = await syncCreatorNow(parsed.data.creatorId);
  } catch (err) {
    console.error("[emails/suggestions] post-link sync failed", err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ ok: true, synced });
}
