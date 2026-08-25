import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, badRequest } from "@/lib/api-helpers";
import { applyAutoStage } from "@/lib/auto-stage";
import { db } from "@/lib/db";
import { cmDeliverables, cmPlatformEnum } from "@/lib/db/schema";
import { instagramShortcode } from "@/lib/csv";
import { fetchPosts } from "@/lib/apify";

const schema = z.object({
  partnershipId: z.string().uuid(),
  platform: z.enum(cmPlatformEnum.enumValues).default("instagram"),
  url: z.string().url(),
  postedAt: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  /** Default path: pull views/likes/comments/postedAt from Apify (provisional). */
  fetchMetrics: z.boolean().default(false),
  /**
   * Manual override for a number the operator read off the Instagram app —
   * the only path that earns the authoritative ig_public_chrome label.
   */
  publicViews: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid deliverable", parsed.error.flatten());
  const d = parsed.data;

  let warning: string | null = null;
  let fetched: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    caption: string | null;
    postedAt: Date | null;
  } | null = null;

  if (d.fetchMetrics && d.platform === "instagram") {
    try {
      const [post] = await fetchPosts([d.url]);
      if (post) {
        fetched = {
          views: post.videoPlayCount,
          likes: post.likesCount,
          comments: post.commentsCount,
          caption: post.caption,
          postedAt: post.timestamp ? new Date(post.timestamp) : null,
        };
      } else {
        warning = "Apify returned no data for this URL — saved without metrics.";
      }
    } catch (err) {
      warning = `Metric fetch failed — saved without metrics. ${err instanceof Error ? err.message : ""}`.trim();
    }
  }

  // Manual publicViews wins over the Apify number and carries the
  // authoritative label; Apify-sourced figures stay provisional ("apify").
  const views = d.publicViews ?? fetched?.views ?? null;
  const metricsSource =
    d.publicViews != null ? ("ig_public_chrome" as const) : fetched?.views != null ? ("apify" as const) : null;

  await db.insert(cmDeliverables).values({
    partnershipId: d.partnershipId,
    platform: d.platform,
    url: d.url,
    shortcode: instagramShortcode(d.url),
    postedAt: d.postedAt ? new Date(d.postedAt) : (fetched?.postedAt ?? null),
    caption: d.caption ?? fetched?.caption ?? null,
    views,
    likes: fetched?.likes ?? null,
    comments: fetched?.comments ?? null,
    metricsSource,
    metricsRefreshedAt: views != null ? new Date() : null,
    notes: d.notes ?? null,
  });

  // A live post advances the pipeline to posted.
  const stageChanged = await applyAutoStage(d.partnershipId, "deliverable_added");

  return NextResponse.json({ ok: true, stageChanged, warning });
}
