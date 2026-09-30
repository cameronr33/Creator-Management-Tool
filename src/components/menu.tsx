"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { cn, SrOnly } from "@/components/ui";

/**
 * A small pop-up menu — the ⋯ on Today rows and Pipeline cards, the owner
 * chip. It renders into document.body with fixed positioning, so a card with
 * overflow-hidden or a scrolling board can't clip it (review, 2026-09-29).
 * Escape, a click outside, or a scroll closes it, and focus goes back to the
 * button that opened it. The panel sits outside the card in the page, so it
 * can't start a card's drag; a board card also ignores a drag that begins on
 * the ⋯ button itself (pipeline-board.tsx, data-no-drag).
 */

const CloseMenu = createContext<() => void>(() => {});

const DEFAULT_TRIGGER =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-faint transition hover:bg-surface-2 hover:text-text";

export function Menu({
  label,
  children,
  trigger,
  triggerClassName = DEFAULT_TRIGGER,
  align = "end",
  moreFor,
}: {
  /** The button's accessible name and tooltip ("More for Josh"). */
  label: string;
  children: ReactNode;
  /** What the button shows (the owner chip's initials); the default is ⋯. */
  trigger?: ReactNode;
  triggerClassName?: string;
  align?: "start" | "end";
  /** A row's id, so a panel it opened can hand focus back to this button. */
  moreFor?: string;
}) {
  const [at, setAt] = useState<{ top?: number; bottom?: number; left?: number; right?: number } | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const open = at !== null;

  const close = (refocus = true) => {
    setAt(null);
    if (refocus) button.current?.focus();
  };

  const toggle = () => {
    if (open) return close();
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.bottom + 280 < window.innerHeight;
    setAt({
      ...(below ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }),
      ...(align === "end" ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.max(8, r.left) }),
    });
  };

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      // The panel sits at the end of the page: Tab closes it and hands focus back to its button.
      if (e.key === "Tab") {
        e.preventDefault();
        close();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...(panel.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
        e.preventDefault();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) close(false);
    };
    const onScroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={button}
        onClick={toggle}
        onMouseDown={(e) => e.stopPropagation()}
        aria-haspopup="menu"
        aria-expanded={open}
        data-more-for={moreFor}
        aria-label={label}
        title={label}
        className={triggerClassName}
      >
        {trigger ?? <MoreHorizontal size={16} />}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            aria-label={label}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ position: "fixed", ...at }}
            className="z-50 min-w-44 max-w-72 animate-pop-in overflow-y-auto rounded-lg border border-border bg-surface py-1 text-sm shadow-float"
          >
            <CloseMenu.Provider value={() => close()}>{children}</CloseMenu.Provider>
          </div>,
          document.body,
        )}
    </>
  );
}

/** One choice in a Menu. Choosing it closes the menu first, then runs `onSelect`. */
export function MenuItem({
  children,
  icon,
  onSelect,
  disabled,
  active,
  tone = "default",
}: {
  children: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Marks the current choice (the owner it already has). */
  active?: boolean;
  tone?: "default" | "danger";
}) {
  const close = useContext(CloseMenu);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        close();
        onSelect();
      }}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left transition focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        tone === "danger" ? "text-bad hover:bg-bad-soft focus:bg-bad-soft" : "text-text hover:bg-surface-2 focus:bg-surface-2",
        active && "font-semibold",
      )}
    >
      {icon && <span className="shrink-0 text-text-faint">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">
        {children}
        {active && <SrOnly> (current)</SrOnly>}
      </span>
    </button>
  );
}

/** A thin rule or a small caption between groups of items. */
export function MenuLabel({ children }: { children?: ReactNode }) {
  return children ? (
    <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-faint">{children}</div>
  ) : (
    <div className="my-1 border-t border-border" role="separator" />
  );
}
