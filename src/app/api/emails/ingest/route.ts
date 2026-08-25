import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiKey, badRequest } from "@/lib/api-helpers";
import { ingestEmails } from "@/lib/email-ingest";

/**
 * POST /api/emails/ingest — API-key auth, for the email-sync skill.
 * Accepts raw Gmail message facts; the server owns all matching logic.
 * Idempotent: re-sent messages are deduped on the Gmail message id.
 */
const messageSchema = z.object({
  externalId: z.string().min(1),
  threadId: z.string().nullable().default(null),
  occurredAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "invalid date"),
  from: z.string().min(1),
  to: z.array(z.string()).default([]),
  cc: z.array(z.string()).default([]),
  subject: z.string().nullable().default(null),
  bodyText: z.string().nullable().default(null),
});

const schema = z.object({ messages: z.array(messageSchema).max(500) });

export async function POST(req: NextRequest) {
  const { error } = await requireApiKey(req);
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid email batch", parsed.error.flatten());

  const result = await ingestEmails(parsed.data.messages);
  return NextResponse.json({ ok: true, ...result });
}
