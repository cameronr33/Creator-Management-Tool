"use client";

import { Fragment, createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { cn, Spinner, SrOnly } from "@/components/ui";

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
  disabled,
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
  disabled?: boolean;
}) {
  const [at, setAt] = useState<{ top?: number; bottom?: number; left?: number; right?: number; maxHeight?: number } | null>(null);
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
    // Open where there's more room, and never taller than that room — a long
    // menu (the stage list) scrolls inside it (review 2026-09-30).
    const spaceBelow = window.innerHeight - r.bottom - 12;
    const spaceAbove = r.top - 12;
    const below = spaceBelow >= 320 || spaceBelow >= spaceAbove;
    setAt({
      ...(below ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }),
      maxHeight: Math.max(120, below ? spaceBelow : spaceAbove),
      // Either way the panel stays inside the screen (review 2026-09-30, R6): 288px is its widest (max-w-72).
      ...(align === "end" ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.max(8, Math.min(r.left, window.innerWidth - 288 - 8)) }),
    });
  };

  useEffect(() => {
    if (!open) return;
    (panel.current?.querySelector<HTMLElement>("[role=menuitem][data-current]:not([disabled])") ?? panel.current?.querySelector<HTMLElement>("[role=menuitem]:not([disabled])"))?.focus();
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
        disabled={disabled}
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
            className="z-50 max-h-[min(26rem,70vh)] min-w-44 max-w-72 animate-pop-in overflow-y-auto rounded-lg border border-border bg-surface py-1 text-sm shadow-float"
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
      data-current={active || undefined}
      title={typeof children === "string" ? children : undefined}
      onClick={() => {
        close();
        onSelect();
      }}
      className={cn(
        // The app's 2px focus ring, drawn inside so the scrolling panel doesn't clip it (R1).
        "flex w-full items-center gap-2 px-3 py-1.5 text-left transition focus-visible:-outline-offset-2 disabled:pointer-events-none disabled:opacity-50",
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

export interface Choice<T extends string> {
  value: T;
  label: string;
  /** Items with the same group sit under one caption, in the order given. */
  group?: string;
  disabled?: boolean;
}

/**
 * A choice that acts the moment you pick it — a stage, an owner, a campaign,
 * the agreement type — as a menu instead of a dropdown (review 2026-09-30,
 * R10): on Windows, arrowing through a closed <select> fires a change at every
 * step, so a keyboard user could move three creators through every stage. Here
 * arrows only move; Enter or a click picks. The trigger looks like a field and
 * is named "Stage: Agreed — change it".
 */
export function ChoiceMenu<T extends string>({
  label,
  value,
  options,
  onChoose,
  placeholder,
  pending = false,
  disabled = false,
  className = "w-44",
  triggerClassName,
}: {
  /** What's being chosen ("Stage", "Owner") — part of the button's name. */
  label: string;
  value: T | null;
  options: Choice<T>[];
  onChoose: (value: T) => void;
  /** Shown when nothing is chosen, or on a "Move to…" button. */
  placeholder?: string;
  pending?: boolean;
  disabled?: boolean;
  className?: string;
  /** Replaces the field look (the navy sidebar's switchers). */
  triggerClassName?: string;
}) {
  const current = options.find((o) => o.value === value) ?? null;
  const shown = current?.label ?? placeholder ?? "Choose…";
  const groups: { name: string | undefined; items: Choice<T>[] }[] = [];
  for (const o of options) {
    const g = groups.find((x) => x.name === o.group);
    if (g) g.items.push(o);
    else groups.push({ name: o.group, items: [o] });
  }
  return (
    <Menu
      label={`${label}: ${current ? current.label : placeholder ?? "none"} — change it`}
      align="start"
      disabled={disabled || pending}
      triggerClassName={
        triggerClassName ??
        cn(
          "inline-flex h-8 items-center justify-between gap-2 rounded-md border border-field bg-surface px-2.5 text-left text-xs text-text shadow-control transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )
      }
      trigger={
        <>
          <span className="min-w-0 truncate">{shown}</span>
          {pending ? <Spinner size={12} className="shrink-0 text-accent" /> : <ChevronDown size={13} className="shrink-0 opacity-70" aria-hidden />}
        </>
      }
    >
      {groups.map((g, i) => (
        <Fragment key={g.name ?? `g${i}`}>
          {g.name && <MenuLabel>{g.name}</MenuLabel>}
          {g.items.map((o) => (
            <MenuItem key={o.value} active={o.value === value} disabled={o.disabled} onSelect={() => o.value !== value && onChoose(o.value)}>
              {o.label}
            </MenuItem>
          ))}
        </Fragment>
      ))}
    </Menu>
  );
}
