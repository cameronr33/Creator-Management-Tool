import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmPartnerships, cmStageTransitions, type CmStage, type cmExitReasonEnum } from "@/lib/db/schema";
import { isTerminal } from "@/lib/stages";

export type ExitReason = (typeof cmExitReasonEnum.enumValues)[number];

/**
 * Change a partnership's stage and record the transition atomically-ish.
 *
 * Closing a deal can carry the exit reason in the same call, so the board's
 * close prompt records "who ended it and why" in one step. Moving back to an
 * active stage clears any stale reason.
 */
export async function changeStage(
  partnershipId: string,
  toStage: CmStage,
  userId?: string,
  opts: { exitReason?: ExitReason | null } = {},
): Promise<void> {
  const [current] = await db
    .select({ stage: cmPartnerships.stage })
    .from(cmPartnerships)
    .where(eq(cmPartnerships.id, partnershipId))
    .limit(1);
  if (!current) throw new Error("Partnership not found");

  const set: Partial<typeof cmPartnerships.$inferInsert> = { updatedAt: new Date() };
  if (opts.exitReason !== undefined) set.exitReason = opts.exitReason;
  else if (!isTerminal(toStage)) set.exitReason = null;

  if (current.stage === toStage) {
    if (opts.exitReason !== undefined) {
      await db.update(cmPartnerships).set(set).where(eq(cmPartnerships.id, partnershipId));
    }
    return;
  }

  await db
    .update(cmPartnerships)
    .set({ ...set, stage: toStage })
    .where(eq(cmPartnerships.id, partnershipId));

  await db.insert(cmStageTransitions).values({
    partnershipId,
    fromStage: current.stage,
    toStage,
    changedBy: userId ?? null,
  });
}
