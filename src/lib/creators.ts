import { and, eq, like, sql } from "drizzle-orm";
import { addCreatorEmail } from "@/lib/creator-emails";
import { db } from "@/lib/db";
import { UserError } from "@/lib/user-error";
import { ensureCampaign } from "@/lib/campaigns";
import { approvalRequired } from "@/lib/approvals";
import {
  cmCreators,
  cmCreatorSocials,
  cmPartnerships,
  cmStageTransitions,
  type CmStage,
} from "@/lib/db/schema";
import { parseSocialUrl, deriveUsername, slugify, type ParsedSocialLink } from "@/lib/social-links";

export interface CreateCreatorInput {
  clientId: string;
  name: string;
  /** Raw pasted links; the first parseable one becomes primary. */
  links: string[];
  campaignId: string;
  stage?: CmStage;
  businessEmail?: string | null;
  contentPillar?: string | null;
  followers?: number | null;
  notes?: string | null;
  userId?: string;
  /** Attach to this creator (the CSV import matched a name-only row to them). */
  existingCreatorId?: string;
  /** Always create a new creator (never match an existing one by handle/slug). */
  forceNew?: boolean;
}

export interface CreateCreatorResult {
  creatorId: string;
  partnershipId: string;
  /** True when we attached to a creator/partnership that already existed. */
  reusedCreator: boolean;
  reusedPartnership: boolean;
  username: string;
}

/** Find a username not already taken for this client (handle, handle-2, …). */
async function uniqueUsername(clientId: string, base: string): Promise<string> {
  const existing = await db
    .select({ username: cmCreators.username })
    .from(cmCreators)
    .where(and(eq(cmCreators.clientId, clientId), like(cmCreators.username, `${base}%`)));
  const taken = new Set(existing.map((r) => r.username));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 500; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Create (or attach to) a creator from pasted profile links, and put them on a
 * campaign so they show up on the board.
 *
 * Used by Add creator and the CSV import; all the logic lives here so it can
 * be exercised by a script without a browser session. It never clobbers an
 * existing partnership's pipeline state — if the creator is already on this
 * campaign, it just returns that partnership so the caller can open it.
 */
export async function createCreatorWithPartnership(
  input: CreateCreatorInput,
): Promise<CreateCreatorResult> {
  const parsedLinks = input.links
    .map((l) => parseSocialUrl(l))
    .filter((l): l is ParsedSocialLink => l !== null);

  const name = input.name.trim();
  if (!name && parsedLinks.length === 0) {
    throw new UserError("Add a name or at least one profile link.");
  }

  const base = deriveUsername(parsedLinks, name) ?? slugify(name);
  if (!base) throw new UserError("Couldn't make a username from that name. Add a profile link, or use letters in the name.");

  // Match an existing creator by the primary handle so re-adding someone who is
  // already tracked attaches to them rather than duplicating.
  const [existingCreator] = input.forceNew
    ? []
    : await db
    .select({ id: cmCreators.id, username: cmCreators.username, businessEmail: cmCreators.businessEmail })
    .from(cmCreators)
    .where(
      and(
        eq(cmCreators.clientId, input.clientId),
        input.existingCreatorId ? eq(cmCreators.id, input.existingCreatorId) : eq(cmCreators.username, base),
      ),
    )
    .limit(1);

  const now = new Date();
  let creatorId: string;
  let username: string;
  const reusedCreator = !!existingCreator;

  if (existingCreator) {
    creatorId = existingCreator.id;
    username = existingCreator.username;
    // Fill in blanks without overwriting what's already known; a different
    // email is kept alongside (it's tracked too), never swapped in.
    await db
      .update(cmCreators)
      .set({
        businessEmail: input.businessEmail ? sql`coalesce(${cmCreators.businessEmail}, ${input.businessEmail})` : undefined,
        contentPillar: input.contentPillar ? sql`coalesce(${cmCreators.contentPillar}, ${input.contentPillar})` : undefined,
        followers: input.followers != null ? sql`coalesce(${cmCreators.followers}, ${input.followers})` : undefined,
        updatedAt: now,
      })
      .where(eq(cmCreators.id, creatorId));
    const email = input.businessEmail?.trim().toLowerCase();
    if (email && existingCreator.businessEmail && existingCreator.businessEmail.toLowerCase() !== email) {
      await addCreatorEmail(creatorId, email, "manual").catch(() => undefined);
    }
  } else {
    username = await uniqueUsername(input.clientId, base);
    const primary = parsedLinks[0];
    const [created] = await db
      .insert(cmCreators)
      .values({
        clientId: input.clientId,
        name: name || username,
        username,
        // Denormalized primary pointer. A creator added by name alone has no
        // link: never a guessed Instagram URL (it would fetch a stranger's photo).
        profileUrl: primary?.url ?? "",
        platform: primary?.platform ?? "other",
        businessEmail: input.businessEmail ?? null,
        contentPillar: input.contentPillar ?? null,
        followers: input.followers ?? null,
        notes: input.notes ?? null,
      })
      .returning({ id: cmCreators.id });
    creatorId = created.id;
  }

  // Socials — first link is primary. Unique on (creatorId, url) so re-adding is
  // a no-op rather than a duplicate row.
  for (const [i, link] of parsedLinks.entries()) {
    await db
      .insert(cmCreatorSocials)
      .values({
        creatorId,
        platform: link.platform,
        url: link.url,
        handle: link.handle,
        isPrimary: i === 0 && !reusedCreator,
      })
      .onConflictDoNothing();
  }

  // Partnership for the chosen campaign.
  const [existingPartnership] = await db
    .select({ id: cmPartnerships.id })
    .from(cmPartnerships)
    .where(
      and(eq(cmPartnerships.creatorId, creatorId), eq(cmPartnerships.campaignId, input.campaignId)),
    )
    .limit(1);

  if (existingPartnership) {
    return {
      creatorId,
      partnershipId: existingPartnership.id,
      reusedCreator,
      reusedPartnership: true,
      username,
    };
  }

  const stage = input.stage ?? "shortlisted";
  // A client that approves creators first gets new ones as "waiting for approval".
  const clientApproval = stage === "shortlisted" && (await approvalRequired(input.clientId)) ? ("pending" as const) : null;
  const [partnership] = await db
    .insert(cmPartnerships)
    .values({ creatorId, campaignId: input.campaignId, stage, notes: input.notes ?? null, clientApproval })
    .returning({ id: cmPartnerships.id });

  await db.insert(cmStageTransitions).values({
    partnershipId: partnership.id,
    fromStage: null,
    toStage: stage,
    changedBy: input.userId ?? null,
    source: "manual",
    reason: "added",
  });

  return {
    creatorId,
    partnershipId: partnership.id,
    reusedCreator,
    reusedPartnership: false,
    username,
  };
}

export interface UpdateCreatorInput {
  name?: string;
  businessEmail?: string | null;
  contentPillar?: string | null;
  followers?: number | null;
  avgViews?: number | null;
  notes?: string | null;
}

export async function updateCreatorProfile(creatorId: string, input: UpdateCreatorInput) {
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) update[k] = v;
  }
  await db.update(cmCreators).set(update).where(eq(cmCreators.id, creatorId));
}

/**
 * Add a social link, parsing the platform/handle out of the URL. A creator
 * who had no link yet (added by name) gets it as their primary one.
 */
export async function addCreatorSocial(creatorId: string, rawUrl: string) {
  const link = parseSocialUrl(rawUrl);
  if (!link) throw new UserError("That doesn't look like a profile link. Paste the full address, starting with https://.");
  const [creator] = await db.select({ profileUrl: cmCreators.profileUrl }).from(cmCreators).where(eq(cmCreators.id, creatorId)).limit(1);
  const first = !!creator && !creator.profileUrl;
  const [added] = await db
    .insert(cmCreatorSocials)
    .values({
      creatorId,
      platform: link.platform,
      url: link.url,
      handle: link.handle,
      isPrimary: false,
    })
    .onConflictDoNothing()
    .returning({ id: cmCreatorSocials.id });
  if (first && added) {
    await setPrimarySocial(creatorId, added.id);
    // Their handle was a slug of their name; the link's handle is the real one
    // (shown as @handle, and what the next import matches on) — unless another
    // creator of this client already has it.
    if (link.handle) {
      const [me] = await db.select({ clientId: cmCreators.clientId }).from(cmCreators).where(eq(cmCreators.id, creatorId)).limit(1);
      const [taken] = me
        ? await db.select({ id: cmCreators.id }).from(cmCreators).where(and(eq(cmCreators.clientId, me.clientId), eq(cmCreators.username, link.handle))).limit(1)
        : [];
      if (me && !taken) await db.update(cmCreators).set({ username: link.handle }).where(eq(cmCreators.id, creatorId));
    }
  }
  return link;
}

/** Scoped to the creator in the URL so a stray id can't delete another creator's link. */
export async function removeCreatorSocial(creatorId: string, socialId: string) {
  await db
    .delete(cmCreatorSocials)
    .where(and(eq(cmCreatorSocials.id, socialId), eq(cmCreatorSocials.creatorId, creatorId)));
}

/** Promote a link to primary and mirror it onto the creator's denormalized fields. */
export async function setPrimarySocial(creatorId: string, socialId: string) {
  const [social] = await db
    .select()
    .from(cmCreatorSocials)
    .where(and(eq(cmCreatorSocials.id, socialId), eq(cmCreatorSocials.creatorId, creatorId)))
    .limit(1);
  if (!social) throw new UserError("That link isn't on this creator any more. Reload the page.");

  await db
    .update(cmCreatorSocials)
    .set({ isPrimary: false })
    .where(eq(cmCreatorSocials.creatorId, creatorId));
  await db
    .update(cmCreatorSocials)
    .set({ isPrimary: true })
    .where(eq(cmCreatorSocials.id, socialId));
  await db
    .update(cmCreators)
    .set({ profileUrl: social.url, platform: social.platform, updatedAt: new Date() })
    .where(eq(cmCreators.id, creatorId));
}

/** Campaign lookup/creation shared with the add form — names match ignoring case. */
export async function ensureCampaignByName(clientId: string, name: string): Promise<string> {
  return (await ensureCampaign(clientId, name)).id;
}
