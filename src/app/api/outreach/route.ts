import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAgency, badRequest, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { logMessage } from "@/lib/logging";
import { cmOutreachDirectionEnum, cmOutreachChannelEnum, cmOutreachKindEnum } from "@/lib/db/schema";

const schema = z.object({
  partnershipId: z.string().uuid(),
  direction: z.enum(cmOutreachDirectionEnum.enumValues),
  channel: z.enum(cmOutreachChannelEnum.enumValues).default("ig_dm"),
  kind: z.enum(cmOutreachKindEnum.enumValues),
  body: z.string().max(10_000).optional(),
  subject: z.string().max(500).optional(),
  /** When it happened, when it wasn't just now (Today / Yesterday / a date). */
  occurredAt: z.string().max(40).optional(),
});

/** POST /api/outreach — log a DM, call, note or an email from a teammate's own inbox. */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAgency();
  if (error) return error;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid outreach event", parsed.error.flatten());
  const d = parsed.data;

  const scope = await assertPartnershipInSelectedClient(d.partnershipId);
  if (scope) return scope;

  const r = await logMessage(d, session.user.id);
  if (!r.ok) return badRequest(r.error);
  return NextResponse.json({ ok: true, eventId: r.eventId, stageChanged: r.stageChanged, stageSkipped: r.stageSkipped, undo: r.undo });
}
