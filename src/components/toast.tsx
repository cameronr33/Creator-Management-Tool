"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

/**
 * Page-level feedback for every mutation. Before this, most saves either
 * refreshed silently or did nothing on failure — a teammate couldn't tell
 * "saved", "failed" and "still saving" apart. `toast()` can be called from
 * any client code; `<Toaster />` (mounted once in the app layout) renders it.
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
  good: <CheckCircle2 size={16} className="text-good-strong" />,
  bad: <AlertCircle size={16} className="text-bad" />,
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    const add: Listener = (t) => {
      setItems((prev) => [...prev.slice(-3), t]);
      const ms = t.durationMs ?? (t.tone === "bad" ? 7000 : t.action ? 6000 : 3500);
      timers.set(
        t.id,
        setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), ms),
      );
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm shadow-pop"
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
                setItems((prev) => prev.filter((x) => x.id !== t.id));
              }}
              className="shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold text-accent hover:bg-accent-soft"
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
            className="shrink-0 rounded-md p-0.5 text-text-faint hover:bg-surface-2 hover:text-text"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
