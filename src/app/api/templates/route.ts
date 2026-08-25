import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { requireAuth, badRequest } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { cmMessageTemplates, cmOutreachChannelEnum } from "@/lib/db/schema";

const schema = z.object({
  id: z.string().uuid().optional(),
  clientId: z.string().uuid(),
  name: z.string().min(1),
  channel: z.enum(cmOutreachChannelEnum.enumValues).default("ig_dm"),
  subject: z.string().nullable().optional(),
  body: z.string().min(1),
  isDefault: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid template", parsed.error.flatten());
  const d = parsed.data;

  let templateId = d.id;
  if (d.id) {
    await db
      .update(cmMessageTemplates)
      .set({
        name: d.name,
        channel: d.channel,
        subject: d.subject ?? null,
        body: d.body,
        isDefault: d.isDefault,
        updatedAt: new Date(),
      })
      .where(eq(cmMessageTemplates.id, d.id));
  } else {
    const [row] = await db
      .insert(cmMessageTemplates)
      .values({
        clientId: d.clientId,
        name: d.name,
        channel: d.channel,
        subject: d.subject ?? null,
        body: d.body,
        isDefault: d.isDefault,
      })
      .returning({ id: cmMessageTemplates.id });
    templateId = row.id;
  }

  // Only one default per client per channel — IG and email each keep their own.
  if (d.isDefault && templateId) {
    await db
      .update(cmMessageTemplates)
      .set({ isDefault: false })
      .where(
        and(
          eq(cmMessageTemplates.clientId, d.clientId),
          eq(cmMessageTemplates.channel, d.channel),
          ne(cmMessageTemplates.id, templateId),
        ),
      );
  }

  return NextResponse.json({ ok: true, id: templateId });
}
