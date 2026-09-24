import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAgency, badRequest, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { httpUrl, isoDate } from "@/lib/validation";
import { applyAutoStage } from "@/lib/auto-stage";
import { db } from "@/lib/db";
import { cmDeliverables, cmPlatformEnum } from "@/lib/db/schema";
import { instagramShortcode } from "@/lib/csv";

const schema = z.object({
  partnershipId: z.string().uuid(),
  platform: z.enum(cmPlatformEnum.enumValues).default("instagram"),
  url: httpUrl,
  postedAt: isoDate.nullable().optional(),
  caption: z.string().nullable().optional(),
  /**
   * Optional number the operator read off the Instagram app. Saving a video
   * is link-only (owner decision, 2026-09-22); a typed number is the one
   * that earns the authoritative ig_public_chrome label.
   */
  publicViews: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const { session, error } = await requireAgency();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid deliverable", parsed.error.flatten());
  const d = parsed.data;

  const scope = await assertPartnershipInSelectedClient(d.partnershipId);
  if (scope) return scope;

  const views = d.publicViews ?? null;
  const metricsSource = views != null ? ("ig_public_chrome" as const) : null;

  await db.insert(cmDeliverables).values({
    partnershipId: d.partnershipId,
    platform: d.platform,
    url: d.url,
    shortcode: instagramShortcode(d.url),
    postedAt: d.postedAt ? new Date(d.postedAt) : new Date(),
    caption: d.caption ?? null,
    views,
    metricsSource,
    metricsRefreshedAt: views != null ? new Date() : null,
    notes: d.notes ?? null,
  });

  // A live post advances the pipeline to posted.
  const stageChanged = await applyAutoStage(d.partnershipId, "deliverable_added", session.user.id);

  return NextResponse.json({ ok: true, stageChanged });
}
