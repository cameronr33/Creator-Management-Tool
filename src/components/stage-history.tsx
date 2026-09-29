import { ArrowRight } from "lucide-react";
import { Badge, StagePill, cn } from "@/components/ui";
import { UndoMoveButton } from "@/components/email-status";
import { relativeDays, shortDate } from "@/lib/format";
import type { HistoryItem } from "@/lib/history";

/** How many moves show before "Show N earlier". */
const RECENT = 6;

function Move({ h, partnershipId }: { h: HistoryItem; partnershipId: string }) {
  return (
    <li className="flex gap-3 text-sm">
      <div className="mt-2 h-2 w-2 shrink-0 rounded-full bg-border-strong" />
      <div className="min-w-0 flex-1">
        <div className={cn("flex flex-wrap items-center gap-1.5", h.undone && "opacity-60")}>
          {h.from && (
            <>
              <StagePill stage={h.from} />
              <ArrowRight size={12} className="text-text-faint" aria-label="to" />
            </>
          )}
          <StagePill stage={h.to} />
          {h.undone && <Badge tone="muted">Undone</Badge>}
        </div>
        <p className="mt-1 text-xs text-text-muted">
          {h.who} · {shortDate(h.at)} · {relativeDays(h.at)}
        </p>
        {h.quote && <p className="mt-0.5 text-xs text-text-muted">&ldquo;{h.quote}&rdquo;</p>}
        {h.undone && (
          <p className="mt-0.5 text-xs text-text-faint">
            Undone by {h.undone.by} · {shortDate(h.undone.at)}
          </p>
        )}
        {h.undoable && <UndoMoveButton partnershipId={partnershipId} transitionId={h.id} />}
      </div>
    </li>
  );
}

/** Every stage move, newest first: the stages, who or what moved it, and what was undone. */
export function StageHistory({ partnershipId, items }: { partnershipId: string; items: HistoryItem[] }) {
  if (items.length === 0) return <p className="text-sm text-text-muted">No moves recorded yet.</p>;
  const recent = items.slice(0, RECENT);
  const earlier = items.slice(RECENT);
  return (
    <ol className="space-y-3">
      {recent.map((h) => (
        <Move key={h.id} h={h} partnershipId={partnershipId} />
      ))}
      {earlier.length > 0 && (
        <li>
          <details>
            <summary className="cursor-pointer text-xs font-medium text-text-muted hover:text-accent">Show {earlier.length} earlier</summary>
            <ol className="mt-3 space-y-3">
              {earlier.map((h) => (
                <Move key={h.id} h={h} partnershipId={partnershipId} />
              ))}
            </ol>
          </details>
        </li>
      )}
    </ol>
  );
}
