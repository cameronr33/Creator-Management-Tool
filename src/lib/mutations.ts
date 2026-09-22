import type { CmStage } from "@/lib/db/schema";
import { moveStage, type ExitReason, type StageMoveResult } from "@/lib/stage-moves";

export type { ExitReason };

/**
 * A person moving a stage (board, stage control, bulk). Goes through the one
 * stage-move core so the shipment/video guards and the transition record are
 * identical to automatic moves. A move that lost a race re-reads once and
 * applies to the fresh stage — a person's intent is "put it in X", whatever
 * it was a moment ago.
 */
export async function changeStage(
  partnershipId: string,
  toStage: CmStage,
  userId?: string,
  opts: { exitReason?: ExitReason | null; videoUrl?: string | null } = {},
): Promise<StageMoveResult> {
  let result: StageMoveResult = { status: "not_found" };
  for (let attempt = 0; attempt < 2; attempt++) {
    result = await moveStage({
      partnershipId,
      to: toStage,
      source: "manual",
      userId: userId ?? null,
      exitReason: opts.exitReason,
      videoUrl: opts.videoUrl ?? null,
    });
    if (result.status !== "stale") return result;
  }
  return result;
}
