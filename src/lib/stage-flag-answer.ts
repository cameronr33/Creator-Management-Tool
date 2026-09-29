import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmPartnerships, type CmStage } from "@/lib/db/schema";
import { lastManualChangeAt } from "@/lib/email-ingest";
import { moveStage } from "@/lib/stage-moves";
import { staleStage } from "@/lib/stage-flag";
import { stageLabel } from "@/lib/stages";

export type FlagAnswer = { ok: true; stage: CmStage } | { ok: false; error: string; stale?: boolean };

/**
 * A person's answer to "their emails read as Talking, not Agreed" (the route
 * and verify-today-data share it). Move: a person's move to the suggested
 * stage — worked out here again, never taken from the browser — only while
 * the stage is still the one they saw. Keep: the flag stays away until a
 * newer message reads differently.
 */
export async function answerStageFlag(partnershipId: string, action: "move" | "keep", expect: CmStage, userId: string | null): Promise<FlagAnswer> {
  const [p] = await db
    .select({
      stage: cmPartnerships.stage,
      emailStage: cmPartnerships.emailStage,
      emailStageAt: cmPartnerships.emailStageAt,
      emailStageQuote: cmPartnerships.emailStageQuote,
      stageFlagDismissedAt: cmPartnerships.stageFlagDismissedAt,
    })
    .from(cmPartnerships)
    .where(eq(cmPartnerships.id, partnershipId))
    .limit(1);
  if (!p) return { ok: false, error: "That creator isn't here any more" };
  if (p.stage !== expect) return { ok: false, error: "The stage has moved since — reload the page", stale: true };
  if (action === "keep") {
    await db.update(cmPartnerships).set({ stageFlagDismissedAt: new Date() }).where(eq(cmPartnerships.id, partnershipId));
    return { ok: true, stage: p.stage };
  }
  const suggested = staleStage({
    stage: p.stage,
    emailStage: p.emailStage,
    emailStageAt: p.emailStageAt,
    lastManualChangeAt: (await lastManualChangeAt([partnershipId], { peopleOnly: true })).get(partnershipId) ?? null,
    dismissedAt: p.stageFlagDismissedAt,
  });
  if (!suggested) return { ok: false, error: "Nothing to move — the stage and their emails agree now" };
  const r = await moveStage({
    partnershipId,
    to: suggested,
    source: "manual",
    userId,
    expectFrom: expect,
    exact: true,
    reason: `their emails read as ${stageLabel(suggested)}`,
    meta: { fromFlag: true, quote: p.emailStageQuote },
  });
  if (r.status !== "moved") return { ok: false, error: "The stage has moved since — reload the page", stale: true };
  return { ok: true, stage: suggested };
}
