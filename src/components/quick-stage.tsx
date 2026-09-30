"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { stagesByGroup, stageLabel, stageHint, isTerminal, EXIT_REASONS_BY_STAGE } from "@/lib/stages";
import type { CmStage } from "@/lib/db/schema";
import { Button, IconButton, Select } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import { VideoLinkPrompt, needsVideo } from "@/components/partnership-actions";

/**
 * Change a creator's stage in place — on a Pipeline card or a Today row.
 * Closing asks who ended it and why; Posted asks for the video link when
 * none is recorded. The server may land somewhere else (Agreed with an
 * address on file continues to Ready to ship); the toast says so.
 */
export function QuickStage({
  partnershipId,
  name,
  stage,
  onMoved,
  className = "w-40",
  asMove = false,
}: {
  partnershipId: string;
  name: string;
  stage: CmStage;
  /** Called with where it landed, before the page refreshes (the board moves the card at once). */
  onMoved?: (stage: CmStage) => void;
  className?: string;
  /** On a board card the column already says the stage: show "Move to…" instead. */
  asMove?: boolean;
}) {
  const { pending, run } = useSave();
  const [closingAs, setClosingAs] = useState<CmStage | null>(null);
  const [askVideo, setAskVideo] = useState(false);
  // What you picked, shown until the page catches up (or put back if the save fails).
  const [choosing, setChoosing] = useState<CmStage | null>(null);
  const [seenStage, setSeenStage] = useState(stage);
  if (seenStage !== stage) {
    setSeenStage(stage);
    setChoosing(null);
  }
  const shown = choosing ?? stage;

  const setStage = async (to: CmStage, exitReason?: string | null, videoUrl?: string) => {
    setChoosing(to);
    const r = await run(() => api<{ stage?: CmStage }>(`/api/partnerships/${partnershipId}/stage`, { stage: to, exitReason, videoUrl }), {
      success: `${name} → ${stageLabel(to)}`,
      undo: true,
    });
    setAskVideo(!r.ok && needsVideo(r.data));
    if (!r.ok) setChoosing(null);
    if (r.ok) {
      setClosingAs(null);
      onMoved?.(r.data.stage ?? to);
    }
  };

  return (
    <div className="space-y-2">
      <Select
        compact
        aria-label={`Stage for ${name}`}
        title={stageHint(stage)}
        value={asMove ? "" : shown}
        disabled={pending}
        className={className}
        onChange={(e) => {
          const to = e.target.value as CmStage;
          setAskVideo(false);
          if (isTerminal(to)) setClosingAs(to);
          else {
            setClosingAs(null);
            setStage(to);
          }
        }}
      >
        {asMove && (
          <option value="" disabled>
            Move to…
          </option>
        )}
        {stagesByGroup().map((g) => (
          <optgroup key={g.group} label={g.label}>
            {g.stages.map((s) => (
              <option key={s.value} value={s.value} disabled={asMove && s.value === stage}>
                {s.label}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      {askVideo && <VideoLinkPrompt pending={pending} onSubmit={(url) => setStage("posted", undefined, url)} onCancel={() => setAskVideo(false)} />}
      {closingAs && (
        <div className="rounded-lg border border-info-line bg-accent-soft p-2.5 text-xs">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="font-medium text-text">{stageLabel(closingAs)} — why?</span>
            <IconButton label="Cancel" icon={<X size={13} />} onClick={() => setClosingAs(null)} />
          </div>
          <div className="flex flex-wrap gap-1">
            {(EXIT_REASONS_BY_STAGE[closingAs] ?? []).map((r) => (
              <Button key={r.value} size="sm" pending={pending} onClick={() => setStage(closingAs, r.value)}>
                {r.label}
              </Button>
            ))}
          </div>
          <Button size="sm" variant="link" className="mt-1.5" onClick={() => setStage(closingAs, null)}>
            Skip the reason
          </Button>
        </div>
      )}
    </div>
  );
}
