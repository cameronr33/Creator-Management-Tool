import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmPartnerships, cmStageTransitions, type CmStage } from "@/lib/db/schema";

/** Change a partnership's stage and record the transition atomically-ish. */
export async function changeStage(
  partnershipId: string,
  toStage: CmStage,
  userId?: string,
): Promise<void> {
  const [current] = await db
    .select({ stage: cmPartnerships.stage })
    .from(cmPartnerships)
    .where(eq(cmPartnerships.id, partnershipId))
    .limit(1);
  if (!current) throw new Error("Partnership not found");
  if (current.stage === toStage) return;

  await db
    .update(cmPartnerships)
    .set({ stage: toStage, updatedAt: new Date() })
    .where(eq(cmPartnerships.id, partnershipId));

  await db.insert(cmStageTransitions).values({
    partnershipId,
    fromStage: current.stage,
    toStage,
    changedBy: userId ?? null,
  });
}
