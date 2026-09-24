import { Mail } from "lucide-react";
import { Badge, Callout } from "@/components/ui";
import { UndoMoveButton, CloseAsDeclinedButton } from "@/components/email-status";
import { shortDate } from "@/lib/format";
import { whoseTurnText, type WhoseTurn } from "@/lib/activity";
import { isTerminal, stageLabel } from "@/lib/stages";
import type { CmStage, CmStageTransition } from "@/lib/db/schema";

/**
 * Under a creator's name: what their latest email says, whose turn it is,
 * the automatic move it caused (with Undo), and a flag when it sounds like
 * a no. Words say "from their email" — never the name of the model.
 */
export function EmailStatusLines({
  partnershipId,
  stage,
  summary,
  summaryAt,
  whoseTurn,
  soundsLikeNo,
  move,
}: {
  partnershipId: string;
  stage: CmStage;
  summary: string | null;
  summaryAt: Date | null;
  whoseTurn: string | null;
  soundsLikeNo: boolean;
  move: CmStageTransition | null;
}) {
  const turn = whoseTurnText(whoseTurn === "us" || whoseTurn === "them" || whoseTurn === "none" ? (whoseTurn as WhoseTurn) : null);
  if (!summary && !move && !soundsLikeNo) return null;
  return (
    <div className="mt-2 space-y-2 text-sm">
      {summary && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-text-muted">
          <Mail size={13} className="shrink-0 text-text-faint" />
          <span className="font-medium text-text">Latest email{summaryAt ? ` · ${shortDate(summaryAt)}` : ""}:</span>
          <span>{summary}</span>
          {turn && <Badge tone={turn.tone}>{turn.label}</Badge>}
        </p>
      )}
      {move && (
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
          <span>
            Moved to <span className="font-medium text-text">{stageLabel(move.toStage)}</span> from their email on{" "}
            {shortDate(move.changedAt)}
            {move.reason ? <>: &ldquo;{move.reason}&rdquo;</> : null}
          </span>
          <UndoMoveButton partnershipId={partnershipId} transitionId={move.id} />
        </p>
      )}
      {soundsLikeNo && !isTerminal(stage) && (
        <Callout tone="warn" title="Their latest email sounds like a no" actions={<CloseAsDeclinedButton partnershipId={partnershipId} />}>
          Read it first — nothing closes by itself.
        </Callout>
      )}
    </div>
  );
}
