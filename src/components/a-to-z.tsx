import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ACTIVE_STAGES } from "@/lib/stages";
import type { CmStage } from "@/lib/db/schema";

/**
 * The whole workflow in one line, built from the stage table (frozen node 7:
 * never hand-written): each step, how many creators are in it now, and — on
 * hover — what you do there.
 */
export function AToZStrip({ counts }: { counts: Partial<Record<CmStage, number>> }) {
  return (
    <nav aria-label="How it works, A to Z" className="rounded-xl border border-border bg-surface p-3 shadow-card">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-text">How it works, A to Z</span>
        <Link href="/help" className="text-xs text-text-muted hover:text-accent">
          Full guide
        </Link>
      </div>
      <ol className="flex flex-wrap items-center gap-y-2">
        {ACTIVE_STAGES.map((s, i) => (
          <li key={s.value} className="flex items-center">
            <Link
              href="/pipeline"
              title={`${s.hint} ${s.action}`}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-text-muted transition hover:bg-surface-2 hover:text-text"
            >
              <span className="flex size-5 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-text-muted ring-1 ring-inset ring-border">
                {i + 1}
              </span>
              <span className="font-medium text-text">{s.label}</span>
              <span className="tabular">{counts[s.value] ?? 0}</span>
            </Link>
            {i < ACTIVE_STAGES.length - 1 && <ChevronRight size={13} className="text-text-faint" aria-hidden />}
          </li>
        ))}
      </ol>
    </nav>
  );
}
