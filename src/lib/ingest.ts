import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  clients,
  cmCampaigns,
  cmCreators,
  cmCreatorReels,
  cmCreatorSocials,
  cmPartnerships,
  cmResearchRuns,
} from "@/lib/db/schema";
import { normalizeUsername, normalizeInstagramUrl, instagramShortcode } from "@/lib/csv";

export const reelSchema = z.object({
  rank: z.number().int().min(1).max(10),
  url: z.string().url(),
  views: z.number().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const ingestCreatorSchema = z.object({
  name: z.string().min(1),
  username: z.string().min(1),
  profileUrl: z.string().optional(),
  businessEmail: z.string().nullable().optional(),
  contentPillar: z.string().nullable().optional(),
  followers: z.number().nullable().optional(),
  reelsPulled: z.number().nullable().optional(),
  cadencePerWeek: z.number().nullable().optional(),
  dateRangeStart: z.string().nullable().optional(),
  dateRangeEnd: z.string().nullable().optional(),
  avgViews: z.number().nullable().optional(),
  medianViews: z.number().nullable().optional(),
  maxViews: z.number().nullable().optional(),
  viewsSource: z.enum(["ig_public_chrome", "apify"]).nullable().optional(),
  contentTypeSummary: z.string().nullable().optional(),
  reels: z.array(reelSchema).optional().default([]),
});

export const ingestPayloadSchema = z.object({
  /** Client slug or name. */
  client: z.string().min(1),
  campaign: z.string().min(1),
  contentPillar: z.string().optional(),
  creators: z.array(ingestCreatorSchema).min(1),
});

export type IngestPayload = z.infer<typeof ingestPayloadSchema>;
export type IngestCreator = z.infer<typeof ingestCreatorSchema>;

export interface IngestResult {
  runId: string;
  clientId: string;
  campaignId: string;
  created: number;
  updated: number;
  reelsWritten: number;
}

async function resolveClientId(clientRef: string): Promise<string | null> {
  const slug = clientRef.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const [bySlug] = await db.select({ id: clients.id }).from(clients).where(eq(clients.slug, slug)).limit(1);
  if (bySlug) return bySlug.id;
  const [byName] = await db.select({ id: clients.id }).from(clients).where(eq(clients.name, clientRef)).limit(1);
  return byName?.id ?? null;
}

async function ensureCampaign(clientId: string, name: string): Promise<string> {
  const [existing] = await db
    .select({ id: cmCampaigns.id })
    .from(cmCampaigns)
    .where(and(eq(cmCampaigns.clientId, clientId), eq(cmCampaigns.name, name)))
    .limit(1);
  if (existing) return existing.id;
  const [row] = await db.insert(cmCampaigns).values({ clientId, name }).returning({ id: cmCampaigns.id });
  return row.id;
}

/**
 * Upsert research into the DB. Creator research fields are refreshed; reels are
 * replaced; a partnership at stage `researched` is created only when none
 * exists for that campaign. Pipeline state (stage, agreement, outreach,
 * shipping, deliverables) on an EXISTING partnership is never touched — a
 * re-run of research must not knock a signed deal back to researched.
 */
export async function ingestResearch(
  payload: IngestPayload,
  source: "skill_api" | "csv_upload",
): Promise<IngestResult> {
  const clientId = await resolveClientId(payload.client);
  if (!clientId) throw new Error(`Unknown client: ${payload.client}`);

  const campaignId = await ensureCampaign(clientId, payload.campaign);

  const [run] = await db
    .insert(cmResearchRuns)
    .values({
      clientId,
      campaignId,
      source,
      status: "running",
      handleCount: payload.creators.length,
      rawPayload: payload as unknown as object,
    })
    .returning({ id: cmResearchRuns.id });

  let created = 0;
  let updated = 0;
  let reelsWritten = 0;
  const errors: string[] = [];

  for (const c of payload.creators) {
    try {
      const username = normalizeUsername(c.username);
      const now = new Date();

      const existing = await db
        .select({ id: cmCreators.id })
        .from(cmCreators)
        .where(and(eq(cmCreators.clientId, clientId), eq(cmCreators.username, username)))
        .limit(1);

      const values = {
        clientId,
        name: c.name,
        username,
        profileUrl: c.profileUrl ? normalizeInstagramUrl(c.profileUrl) : normalizeInstagramUrl(username),
        businessEmail: c.businessEmail ?? null,
        contentPillar: c.contentPillar ?? payload.contentPillar ?? null,
        followers: c.followers ?? null,
        reelsPulled: c.reelsPulled ?? null,
        cadencePerWeek: c.cadencePerWeek != null ? String(c.cadencePerWeek) : null,
        dateRangeStart: c.dateRangeStart ?? null,
        dateRangeEnd: c.dateRangeEnd ?? null,
        avgViews: c.avgViews ?? null,
        medianViews: c.medianViews ?? null,
        maxViews: c.maxViews ?? null,
        viewsSource: c.viewsSource ?? null,
        contentTypeSummary: c.contentTypeSummary ?? null,
        researchedAt: now,
        lastRefreshedAt: now,
      };

      const [creator] = await db
        .insert(cmCreators)
        .values(values)
        .onConflictDoUpdate({
          target: [cmCreators.clientId, cmCreators.username],
          set: { ...values, updatedAt: now },
        })
        .returning({ id: cmCreators.id });

      if (existing.length) updated++;
      else created++;

      // Keep the socials table in step with the denormalized primary link, so
      // creators added by research carry a link row like manually-added ones.
      await db
        .insert(cmCreatorSocials)
        .values({
          creatorId: creator.id,
          platform: "instagram",
          url: values.profileUrl,
          handle: username,
          isPrimary: true,
        })
        .onConflictDoNothing();

      // Replace reels.
      await db.delete(cmCreatorReels).where(eq(cmCreatorReels.creatorId, creator.id));
      for (const reel of c.reels ?? []) {
        await db.insert(cmCreatorReels).values({
          creatorId: creator.id,
          rank: reel.rank,
          url: reel.url,
          shortcode: instagramShortcode(reel.url),
          views: reel.views ?? null,
          description: reel.description ?? null,
        });
        reelsWritten++;
      }

      // Ensure a partnership exists WITHOUT disturbing existing pipeline state.
      const [existingPartnership] = await db
        .select({ id: cmPartnerships.id })
        .from(cmPartnerships)
        .where(and(eq(cmPartnerships.creatorId, creator.id), eq(cmPartnerships.campaignId, campaignId)))
        .limit(1);
      if (!existingPartnership) {
        await db.insert(cmPartnerships).values({
          creatorId: creator.id,
          campaignId,
          stage: "researched",
        });
      }
    } catch (err) {
      errors.push(`${c.username}: ${(err as Error).message}`);
    }
  }

  await db
    .update(cmResearchRuns)
    .set({
      status: errors.length ? "failed" : "completed",
      createdCount: created,
      updatedCount: updated,
      errors: errors.length ? errors : null,
      completedAt: new Date(),
    })
    .where(eq(cmResearchRuns.id, run.id));

  return { runId: run.id, clientId, campaignId, created, updated, reelsWritten };
}
