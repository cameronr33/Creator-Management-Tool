"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { Spinner, cn } from "@/components/ui";

/**
 * One place that knows the page is changing under you: switching client or
 * campaign, Mine / Everyone, a search. While it's pending the main area dims
 * (and can't be clicked, so nobody acts on the old client's data) and a small
 * pill says what's happening. A search asks not to dim — you're still typing —
 * and shows its own spinner; the list under it uses <PendingDim>.
 */

interface MainPending {
  pending: boolean;
  /** "Switching to MEYLE North America…", or null for a plain dim. */
  label: string | null;
  /** Dim the whole main area (false for a search: only the list dims). */
  dim: boolean;
  start: (fn: () => void | Promise<void>, opts?: { label?: string; dim?: boolean }) => void;
}

const Ctx = createContext<MainPending>({ pending: false, label: null, dim: false, start: (fn) => void fn() });

export function MainPendingProvider({ children }: { children: ReactNode }) {
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState<string | null>(null);
  const [dim, setDim] = useState(true);
  const start: MainPending["start"] = (fn, opts = {}) => {
    setLabel(opts.label ?? null);
    setDim(opts.dim ?? true);
    startTransition(async () => {
      await fn();
    });
  };
  return <Ctx.Provider value={{ pending, label, dim, start }}>{children}</Ctx.Provider>;
}

export function useMainPending() {
  return useContext(Ctx);
}

/** The app's <main>: dims while the page is being replaced. */
export function MainRegion({ children }: { children: ReactNode }) {
  const { pending, label, dim } = useMainPending();
  return (
    <main className="relative min-w-0 flex-1" aria-busy={pending || undefined}>
      {pending && label && (
        <div role="status" className="pointer-events-none fixed top-3 left-1/2 z-40 flex -translate-x-1/2 animate-pop-in items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm font-medium text-text shadow-float">
          <Spinner size={13} className="text-accent" />
          {label}
        </div>
      )}
      <div className={cn("transition-opacity duration-(--duration-quick)", pending && dim && "pointer-events-none opacity-45")}>{children}</div>
    </main>
  );
}

/** Dims just what's under it while a no-dim change (a search) is loading. */
export function PendingDim({ children }: { children: ReactNode }) {
  const { pending, dim } = useMainPending();
  return <div className={cn("transition-opacity duration-(--duration-quick)", pending && !dim && "opacity-50")}>{children}</div>;
}
