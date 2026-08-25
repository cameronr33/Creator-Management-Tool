import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, badRequest } from "@/lib/api-helpers";
import { applyAutoStage } from "@/lib/auto-stage";
import { db } from "@/lib/db";
import {
  cmOutreachEvents,
  cmOutreachDirectionEnum,
  cmOutreachChannelEnum,
  cmOutreachKindEnum,
} from "@/lib/db/schema";

const schema = z.object({
  partnershipId: z.string().uuid(),
  direction: z.enum(cmOutreachDirectionEnum.enumValues),
  channel: z.enum(cmOutreachChannelEnum.enumValues).default("ig_dm"),
  kind: z.enum(cmOutreachKindEnum.enumValues),
  body: z.string().optional(),
  subject: z.string().optional(),
  occurredAt: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid outreach event", parsed.error.flatten());
  const d = parsed.data;

  await db.insert(cmOutreachEvents).values({
    partnershipId: d.partnershipId,
    direction: d.direction,
    channel: d.channel,
    kind: d.kind,
    body: d.body ?? null,
    subject: d.subject ?? null,
    occurredAt: d.occurredAt ? new Date(d.occurredAt) : new Date(),
    createdBy: session.user.id,
  });

  // Sending a first message implies contacted; a reply implies
  // in_conversation. Notes never advance the stage.
  const trigger =
    d.direction === "inbound" && d.kind === "reply"
      ? ("inbound_message" as const)
      : d.direction === "outbound" && (d.kind === "initial" || d.kind === "follow_up")
        ? ("outbound_message" as const)
        : null;
  const stageChanged = trigger
    ? await applyAutoStage(d.partnershipId, trigger, session.user.id)
    : null;

  return NextResponse.json({ ok: true, stageChanged });
}
