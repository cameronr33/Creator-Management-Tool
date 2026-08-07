import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, badRequest } from "@/lib/api-helpers";
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
    occurredAt: d.occurredAt ? new Date(d.occurredAt) : new Date(),
    createdBy: session.user.id,
  });

  return NextResponse.json({ ok: true });
}
