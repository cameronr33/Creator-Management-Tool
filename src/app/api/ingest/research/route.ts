import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey, badRequest } from "@/lib/api-helpers";
import { ingestPayloadSchema, ingestResearch } from "@/lib/ingest";

/**
 * Machine ingestion endpoint for the creator-research skill (Step 12).
 * Auth: Authorization: Bearer <cm_api_key>.
 */
export async function POST(req: NextRequest) {
  const { error } = await requireApiKey(req);
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = ingestPayloadSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid payload", parsed.error.flatten());

  try {
    const result = await ingestResearch(parsed.data, "skill_api");
    // A batch where some creators failed is not a success — say so, with the
    // failures, instead of a green `ok` that hides them in the run row.
    return NextResponse.json(
      { ok: result.errors.length === 0, ...result },
      { status: result.errors.length === 0 ? 200 : 207 },
    );
  } catch (err) {
    return badRequest((err as Error).message);
  }
}
