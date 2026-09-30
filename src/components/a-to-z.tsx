import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ACTIVE_STAGES } from "@/lib/stages";
import type { CmStage } from "@/lib/db/schema";

/**
 * The whole workflow in one line, built from the stage table (frozen node 7:
 * never hand-written): each step, how many creators are in it now, and — on
 * hover — what you do there.
 */
export function AToZStrip({
  counts,
  links = true,
}: {
  counts: Partial<Record<CmStage, number>>;
  /** false in the client portal: the steps are shown, not links into the agency's pages. */
  links?: boolean;
}) {
  return (
    <nav aria-label="How it works, A to Z" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-surface px-3 py-2 shadow-control">
      <span className="text-xs font-semibold text-text">A to Z</span>
      <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-y-1">
        {ACTIVE_STAGES.map((s, i) => (
          <li key={s.value} className="flex items-center">
            {(() => {
              const inner = (
                <>
                  <span className={(counts[s.value] ?? 0) > 0 ? "font-medium text-text" : "text-text-faint"}>{s.label}</span>
                  <span className={(counts[s.value] ?? 0) > 0 ? "tabular font-semibold text-accent" : "tabular text-text-faint"}>{counts[s.value] ?? 0}</span>
                </>
              );
              const cls = "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-text-muted transition hover:bg-surface-2 hover:text-text";
              return links ? (
                <Link href={`/creators?stage=${s.value}`} title={`${s.hint} ${s.action}`} className={cls}>
                  {inner}
                </Link>
              ) : (
                <span title={s.hint} className={cls}>
                  {inner}
                </span>
              );
            })()}
            {i < ACTIVE_STAGES.length - 1 && <ChevronRight size={12} className="text-text-faint" aria-hidden />}
          </li>
        ))}
      </ol>
      {links && (
        <Link href="/help" className="text-xs text-text-muted hover:text-accent">
          Full guide
        </Link>
      )}
    </nav>
  );
}
