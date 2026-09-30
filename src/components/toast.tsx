"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/components/ui";

/**
 * Page-level feedback for every mutation. Before this, most saves either
 * refreshed silently or did nothing on failure — a teammate couldn't tell
 * "saved", "failed" and "still saving" apart. `toast()` can be called from
 * any client code; `<Toaster />` (mounted once in the app layout) renders it.
 *
 * Interaction review 2026-09-30: toasts slide in and fade out, a thin line
 * shows the time left, and the timer stops while the pointer is on a toast
 * (so an Undo doesn't vanish as you reach for it). Errors are announced to
 * screen readers at once; everything else politely.
 */

export type ToastTone = "info" | "good" | "bad";

export interface ToastOptions {
  tone?: ToastTone;
  /** Second, smaller line. */
  detail?: string;
  /** One optional action, e.g. Undo. */
  action?: { label: string; onClick: () => void };
  durationMs?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
  tone: ToastTone;
}

type Listener = (t: ToastItem) => void;
const listeners = new Set<Listener>();
let seq = 0;

export function toast(message: string, opts: ToastOptions = {}): number {
  const item: ToastItem = { id: ++seq, message, ...opts, tone: opts.tone ?? "info" };
  listeners.forEach((l) => l(item));
  return item.id;
}

const ICON = {
  info: <Info size={16} className="text-accent" />,
  good: <CheckCircle2 size={16} className="text-good" />,
  bad: <AlertCircle size={16} className="text-bad" />,
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const add: Listener = (t) => setItems((prev) => [...prev.slice(-3), t]);
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);

  const remove = useCallback((id: number) => setItems((prev) => prev.filter((x) => x.id !== id)), []);
  const errors = items.filter((t) => t.tone === "bad");
  const others = items.filter((t) => t.tone !== "bad");

  // Both live regions always exist, so a screen reader hears what's added to them.
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      <div className="flex flex-col gap-2" role="status" aria-live="polite">
        {others.map((t) => (
          <ToastCard key={t.id} t={t} onGone={remove} />
        ))}
      </div>
      <div className="flex flex-col gap-2" aria-live="assertive">
        {errors.map((t) => (
          <ToastCard key={t.id} t={t} onGone={remove} />
        ))}
      </div>
    </div>
  );
}

function ToastCard({ t, onGone }: { t: ToastItem; onGone: (id: number) => void }) {
  const total = t.durationMs ?? (t.tone === "bad" ? 7000 : t.action ? 6000 : 3500);
  const [paused, setPaused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const remaining = useRef(total);

  useEffect(() => {
    if (paused || leaving) return;
    const started = Date.now();
    const timer = setTimeout(() => setLeaving(true), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(800, remaining.current - (Date.now() - started));
    };
  }, [paused, leaving]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => onGone(t.id), 160);
    return () => clearTimeout(timer);
  }, [leaving, onGone, t.id]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      title={paused ? "Paused while you're on it" : undefined}
      className={cn(
        "pointer-events-auto relative flex animate-toast-in items-start gap-2.5 overflow-hidden rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm shadow-float transition duration-(--duration-quick)",
        leaving && "translate-y-1 opacity-0",
      )}
    >
      <span className="mt-0.5 shrink-0">{ICON[t.tone]}</span>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-text">{t.message}</div>
        {t.detail && <div className="mt-0.5 text-xs text-text-muted">{t.detail}</div>}
      </div>
      {t.action && (
        <button
          type="button"
          onClick={() => {
            t.action?.onClick();
            setLeaving(true);
          }}
          className="shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold text-accent hover:bg-accent-soft"
        >
          {t.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => setLeaving(true)}
        className="shrink-0 rounded-md p-0.5 text-text-faint hover:bg-surface-2 hover:text-text"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
      {/* Time left: runs with the timer, stops with it. Hidden when motion is reduced. */}
      <span aria-hidden className="toast-timer absolute inset-x-0 bottom-0 h-0.5 bg-surface-2">
        <span
          className="block h-full origin-left bg-accent-ring/70"
          style={{ animation: `toast-timer ${total}ms linear forwards`, animationPlayState: paused || leaving ? "paused" : "running" }}
        />
      </span>
    </div>
  );
}
