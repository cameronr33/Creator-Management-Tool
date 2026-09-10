import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireApiKey, badRequest } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { cmResearchRequests, cmResearchRequestStatusEnum } from "@/lib/db/schema";

const schema = z.object({
  status: z.enum(cmResearchRequestStatusEnum.enumValues),
  error: z.string().nullable().optional(),
  /** Set by the runner once it has pushed results via /api/ingest/research. */
  researchRunId: z.string().uuid().nullable().optional(),
});

/**
 * Runner claims a queued request (`status: "running"`), then reports the
 * outcome (`"completed"` or `"failed"` + error). API-key auth — this is the
 * creator-research skill's queue_client.py, not a browser session.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireApiKey(req);
  if (error) return error;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid update", parsed.error.flatten());
  const d = parsed.data;

  const now = new Date();
  const update: Record<string, unknown> = { status: d.status };
  if (d.status === "running") update.startedAt = now;
  if (d.status === "completed" || d.status === "failed" || d.status === "cancelled") {
    update.completedAt = now;
  }
  if (d.error !== undefined) update.error = d.error;
  if (d.researchRunId !== undefined) update.researchRunId = d.researchRunId;

  // Claiming is compare-and-set: only a `queued` row can become `running`, so
  // two runners polling the same queue can't both take the same request.
  const [row] = await db
    .update(cmResearchRequests)
    .set(update)
    .where(
      d.status === "running"
        ? and(eq(cmResearchRequests.id, id), eq(cmResearchRequests.status, "queued"))
        : eq(cmResearchRequests.id, id),
    )
    .returning();

  if (!row) {
    if (d.status === "running") {
      const [existing] = await db
        .select({ status: cmResearchRequests.status })
        .from(cmResearchRequests)
        .where(eq(cmResearchRequests.id, id))
        .limit(1);
      if (existing) {
        return NextResponse.json(
          { error: `Already ${existing.status} — claimed by another runner` },
          { status: 409 },
        );
      }
    }
    return badRequest("Request not found");
  }
  return NextResponse.json({ ok: true, request: row });
}
