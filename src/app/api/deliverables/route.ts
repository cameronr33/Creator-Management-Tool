import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, badRequest } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { cmDeliverables, cmPlatformEnum } from "@/lib/db/schema";
import { instagramShortcode } from "@/lib/csv";

const schema = z.object({
  partnershipId: z.string().uuid(),
  platform: z.enum(cmPlatformEnum.enumValues).default("instagram"),
  url: z.string().url(),
  postedAt: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  views: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid deliverable", parsed.error.flatten());
  const d = parsed.data;

  await db.insert(cmDeliverables).values({
    partnershipId: d.partnershipId,
    platform: d.platform,
    url: d.url,
    shortcode: instagramShortcode(d.url),
    postedAt: d.postedAt ? new Date(d.postedAt) : null,
    caption: d.caption ?? null,
    views: d.views ?? null,
    metricsSource: d.views != null ? "ig_public_chrome" : null,
    metricsRefreshedAt: d.views != null ? new Date() : null,
    notes: d.notes ?? null,
  });

  return NextResponse.json({ ok: true });
}
