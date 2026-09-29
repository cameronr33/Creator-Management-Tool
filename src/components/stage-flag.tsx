"use client";

import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import { stageLabel } from "@/lib/stages";
import type { CmStage } from "@/lib/db/schema";

/**
 * The answer to "their emails read as Talking, not Agreed": Move to Talking
 * (a person's move), or Keep Agreed. Nothing moves backward by itself.
 */
export function StageFlagButtons({ partnershipId, name, stage, suggested }: { partnershipId: string; name: string; stage: CmStage; suggested: CmStage }) {
  const { pending, run } = useSave();
  const answer = (action: "move" | "keep") =>
    run(() => api(`/api/partnerships/${partnershipId}/stage-flag`, { action, expect: stage }), {
      success: action === "move" ? `${name} → ${stageLabel(suggested)}` : `Keeping ${name} at ${stageLabel(stage)}`,
    });
  return (
    <>
      <Button size="sm" variant="primary" icon={<Undo2 size={13} />} pending={pending} onClick={() => answer("move")}>
        Move to {stageLabel(suggested)}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} title="The stage is right — don't ask again unless a newer message reads differently" onClick={() => answer("keep")}>
        Keep {stageLabel(stage)}
      </Button>
    </>
  );
}
