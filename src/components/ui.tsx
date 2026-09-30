import Image from "next/image";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ArrowLeft, CircleHelp, Loader2 } from "lucide-react";
import type { CmStage } from "@/lib/db/schema";
import { stageHint, stageLabel, stageStyle } from "@/lib/stages";
import { HelpPopover } from "@/components/help-popover";

/**
 * The design system. Every screen builds from these so the same action
 * looks the same everywhere — a teammate learns "blue filled = the main
 * thing to do here, outlined = optional, red outline = destructive" once.
 * Colours come only from the tokens in globals.css.
 */

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ── Page structure ─────────────────────────────────────────────── */

export function PageHeader({
  title,
  subtitle,
  help,
  helpAnchor,
  client,
  campaign,
  back,
  backSlot,
  actions,
  children,
}: {
  title: string;
  /** Dynamic line — counts, the active client. */
  subtitle?: ReactNode;
  /** Static line: what this page is for, in one sentence. */
  help?: string;
  /** Section id on /help — renders a small "?" link. */
  helpAnchor?: string;
  /** Active client name, always visible so nobody edits the wrong client's data. */
  client?: string | null;
  /**
   * The sidebar's campaign scope: a name when the page shows one campaign,
   * null for "All campaigns", undefined on pages the scope doesn't touch.
   */
  campaign?: string | null;
  back?: { href: string; label: string };
  /** A back control that isn't a plain link (Help's history-aware BackLink). */
  backSlot?: ReactNode;
  actions?: ReactNode;
  /** A second row under the title — filter bars, tabs. */
  children?: ReactNode;
}) {
  return (
    <div className="border-b border-border bg-surface px-6 py-4">
      {back && (
        <Link
          href={back.href}
          className="mb-2 inline-flex items-center gap-1 text-sm text-text-muted transition hover:text-accent"
        >
          <ArrowLeft size={14} /> {back.label}
        </Link>
      )}
      {!back && backSlot}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-text">{title}</h1>
            {client && <Badge tone="accent">{client}</Badge>}
            {campaign !== undefined && (
              <Badge tone={campaign ? "info" : "muted"} title="Change it in the sidebar, under Campaign">
                {campaign ?? "All campaigns"}
              </Badge>
            )}
            {help ? (
              <HelpPopover help={help} helpAnchor={helpAnchor} />
            ) : (
              helpAnchor && (
                <Link
                  href={`/help#${helpAnchor}`}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-text-faint transition hover:bg-surface-2 hover:text-accent"
                  title="How this page works"
                  aria-label="How this page works"
                >
                  <CircleHelp size={15} />
                </Link>
              )
            )}
          </div>
          {subtitle && <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function Card({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("rounded-xl bg-surface shadow-card", className)}>
      {children}
    </section>
  );
}

/** Title row inside a Card: label, optional description, optional actions on the right. */
export function CardHeader({
  title,
  description,
  icon,
  actions,
  info,
  className = "",
}: {
  title: ReactNode;
  /** One short line: what this card is. */
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  /** How it works, read once — behind a small ⓘ instead of above the content every time (design review 2026-09-30). */
  info?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-2", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          {icon && <span className="text-text-faint">{icon}</span>}
          <SectionTitle>{title}</SectionTitle>
          {info && <HelpPopover help={info} label={`How ${typeof title === "string" ? title : "this"} works`} />}
        </div>
        {description && <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-[15px] font-semibold tracking-tight text-text">{children}</h2>;
}

/* ── Status ─────────────────────────────────────────────────────── */

export function StagePill({ stage, size = "sm" }: { stage: CmStage; size?: "sm" | "md" }) {
  return (
    <span
      title={stageHint(stage)}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full font-medium ring-1 ring-inset",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        stageStyle(stage),
      )}
    >
      {stageLabel(stage)}
    </span>
  );
}

export type BadgeTone = "neutral" | "accent" | "info" | "warn" | "good" | "bad" | "muted";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-text-muted ring-border-strong",
  accent: "bg-accent-soft text-accent ring-info-line",
  info: "bg-info-soft text-info ring-info-line",
  warn: "bg-warn-soft text-warn ring-warn-line",
  good: "bg-good-soft text-good ring-good-line",
  bad: "bg-bad-soft text-bad ring-bad-line",
  muted: "bg-surface-2 text-text-faint ring-border",
};

export function Badge({
  children,
  tone = "neutral",
  title,
  className = "",
}: {
  children: ReactNode;
  tone?: BadgeTone;
  /** Tooltip — use it to explain abbreviations like "est". */
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Who looks after a deal, as a small round chip with their initials — filled
 * when it's yours, quiet when it's a teammate's. The full name is the tooltip
 * and the accessible label.
 */
export function OwnerChip({ label, name, mine = false }: { label: string; name: string; mine?: boolean }) {
  return (
    <span
      role="img"
      aria-label={`Owner: ${name}`}
      title={mine ? `Yours (${name})` : `${name}'s`}
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-semibold leading-none",
        mine ? "bg-accent text-white" : "bg-surface-2 text-text-muted ring-1 ring-inset ring-border",
      )}
    >
      {label}
    </span>
  );
}

/** A small dashed chip that does one thing — "Take it" on an unassigned deal. Sits where an OwnerChip would. */
export function ChipButton({ children, icon, onClick, disabled, title }: { children: ReactNode; icon?: ReactNode; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-dashed border-border-strong px-1.5 text-[11px] font-medium text-text-muted transition hover:border-accent hover:text-accent disabled:opacity-50"
    >
      {icon}
      {children}
    </button>
  );
}

/** The dashed "Take it" chip as a look only — for inside a button that isn't this one (the owner menu's trigger). */
export function DashedChip({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-dashed border-border-strong px-1.5 text-[11px] font-medium text-text-muted transition hover:border-accent hover:text-accent">
      {icon}
      {children}
    </span>
  );
}

/**
 * A creator's picture, or their initials when there isn't one. `src` is the
 * app's own photo URL (/api/creators/[id]/photo) — never Instagram's link.
 */
export function Avatar({ name, size = "md", src }: { name: string; size?: "sm" | "md" | "lg"; src?: string | null }) {
  const px = size === "sm" ? 28 : size === "lg" ? 44 : 32;
  if (src) {
    return (
      <Image
        src={src}
        alt=""
        width={px}
        height={px}
        unoptimized
        className="shrink-0 rounded-full object-cover ring-1 ring-inset ring-border"
        style={{ width: px, height: px }}
      />
    );
  }
  const label = name
    .trim()
    .split(/[\s&/]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  const dims = size === "sm" ? "h-7 w-7 text-[11px]" : size === "lg" ? "h-11 w-11 text-sm" : "h-8 w-8 text-xs";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent ring-1 ring-inset ring-info-line",
        dims,
      )}
      aria-hidden="true"
    >
      {label || "?"}
    </span>
  );
}

export function Spinner({ size = 14, className = "" }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn("animate-spin", className)} aria-hidden="true" />;
}

/* ── Messages ───────────────────────────────────────────────────── */

export type CalloutTone = "info" | "good" | "warn" | "bad";

const CALLOUT_TONES: Record<CalloutTone, string> = {
  info: "border-info-line bg-info-soft text-info",
  good: "border-good-line bg-good-soft text-good",
  warn: "border-warn-line bg-warn-soft text-warn",
  bad: "border-bad-line bg-bad-soft text-bad",
};

/** An inline notice — the one way to show a warning, error or success message in the page body. */
export function Callout({
  tone = "info",
  title,
  children,
  icon,
  actions,
  className = "",
}: {
  tone?: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-x-2.5 gap-y-2 rounded-lg border px-3.5 py-2.5 text-sm",
        CALLOUT_TONES[tone],
        className,
      )}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-[14rem] flex-1">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={cn("leading-relaxed", title ? "mt-0.5 text-[13px] opacity-90" : "")}>{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  icon,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center">
      {icon && <span className="mb-1 text-text-faint">{icon}</span>}
      <p className="text-sm font-medium text-text">{title}</p>
      {hint && <p className="max-w-md text-sm text-text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  href,
  tone = "neutral",
  title,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  href?: string;
  tone?: "neutral" | "warn" | "accent";
  /** Tooltip explaining the number. */
  title?: string;
}) {
  // Same card as every other card; a tone adds a coloured edge (warn, accent) on top.
  const ring = tone === "warn" ? "ring-1 ring-inset ring-warn-line" : tone === "accent" ? "ring-1 ring-inset ring-info-line" : "";
  const inner = (
    <div
      title={title}
      className={cn(
        "rounded-xl bg-surface p-4 shadow-card transition",
        ring,
        href && "hover:ring-1 hover:ring-inset hover:ring-accent-ring",
      )}
    >
      <div className="text-xs font-medium text-text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular text-text">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-text-faint">{sub}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-xl">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/* ── Actions ────────────────────────────────────────────────────── */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition select-none disabled:pointer-events-none disabled:opacity-50";

// Every button answers a press: a darker fill and a slight squeeze (not links — they're text).
const PRESS = "active:scale-[0.98]";
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: `bg-accent text-white shadow-control hover:bg-accent-hover active:bg-accent-active ${PRESS}`,
  secondary: `bg-surface text-text shadow-control hover:bg-surface-2 active:bg-surface-3 ${PRESS}`,
  ghost: `text-text-muted hover:bg-surface-2 hover:text-text active:bg-surface-3 ${PRESS}`,
  danger: `border border-bad-line bg-surface text-bad hover:bg-bad-soft active:bg-bad-line/40 ${PRESS}`,
  link: "text-accent hover:underline",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-xs",
  md: "h-9 px-3 text-sm",
};

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button. */
  pending?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
  /** Renders a Next link styled as a button. */
  href?: string;
  target?: string;
  rel?: string;
  autoFocus?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  pending = false,
  icon,
  children,
  className = "",
  onClick,
  type = "button",
  disabled,
  title,
  href,
  target,
  rel,
  autoFocus,
  ...rest
}: ButtonProps) {
  const classes = cn(
    BUTTON_BASE,
    BUTTON_VARIANTS[variant],
    variant === "link" ? "h-auto px-0 text-sm" : BUTTON_SIZES[size],
    className,
  );
  // Pending: the spinner takes the icon's place. With no icon it sits over the
  // hidden label, so the button keeps its width and nothing next to it moves.
  const spinner = <Spinner size={size === "sm" ? 13 : 14} />;
  const content =
    pending && !icon ? (
      <>
        <span className="invisible inline-flex items-center gap-1.5">{children}</span>
        <span className="absolute inset-0 flex items-center justify-center">{spinner}</span>
      </>
    ) : (
      <>
        {pending ? spinner : icon}
        {children}
      </>
    );
  if (href && !disabled && !pending) {
    return (
      <Link href={href} target={target} rel={rel} className={classes} title={title} aria-label={rest["aria-label"]}>
        {content}
      </Link>
    );
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || pending}
      title={title}
      aria-label={rest["aria-label"]}
      autoFocus={autoFocus}
      className={classes}
    >
      {content}
    </button>
  );
}

/** Icon-only button. `label` is required — it's the accessible name and the tooltip. */
export function IconButton({
  label,
  icon,
  onClick,
  variant = "ghost",
  size = "sm",
  disabled,
  pending,
  className = "",
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  variant?: "ghost" | "secondary" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  pending?: boolean;
  className?: string;
}) {
  const tone =
    variant === "danger"
      ? "text-text-faint hover:bg-bad-soft hover:text-bad"
      : variant === "secondary"
        ? "bg-surface text-text-muted shadow-control hover:bg-surface-2 hover:text-text"
        : "text-text-faint hover:bg-surface-2 hover:text-text";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md transition active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-8 w-8" : "h-9 w-9",
        tone,
        className,
      )}
    >
      {pending ? <Spinner size={13} /> : icon}
    </button>
  );
}

/** A row of mutually exclusive options (DM / Email, Ready / Shipped / Delivered). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
  disabled,
  "aria-label": ariaLabel,
}: {
  options: { value: T; label: ReactNode; title?: string }[];
  value: T | null;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex overflow-hidden rounded-md bg-surface shadow-control"
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            title={o.title}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center gap-1 font-medium transition disabled:opacity-50",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3 text-sm",
              i > 0 && "border-l border-border",
              active ? "bg-accent text-white" : "text-text-muted hover:bg-surface-2 hover:text-text",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Form controls ──────────────────────────────────────────────── */

const FIELD_BASE =
  "w-full rounded-md border border-field bg-surface text-text shadow-control placeholder:text-text-faint transition focus:border-accent-ring focus:ring-2 focus:ring-accent-soft focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-70";

const FIELD_INVALID = "border-bad focus:border-bad focus:ring-bad-soft";

// React 19: `ref` is an ordinary prop, so these accept one without forwardRef.
type NativeInput = Omit<ComponentProps<"input">, "size">;
type NativeSelect = Omit<ComponentProps<"select">, "size">;
type NativeTextarea = ComponentProps<"textarea">;

export function Input({
  compact,
  invalid,
  className = "",
  ...props
}: NativeInput & { compact?: boolean; invalid?: boolean }) {
  return (
    <input
      {...props}
      className={cn(FIELD_BASE, compact ? "h-8 px-2.5 text-xs" : "h-9 px-3 text-sm", invalid && FIELD_INVALID, className)}
    />
  );
}

export function Select({
  compact,
  invalid,
  className = "",
  children,
  ...props
}: NativeSelect & { compact?: boolean; invalid?: boolean }) {
  return (
    <select
      {...props}
      className={cn(
        FIELD_BASE,
        "select-chevron appearance-none pr-8",
        compact ? "h-8 pl-2.5 text-xs" : "h-9 pl-3 text-sm",
        invalid && FIELD_INVALID,
        className,
      )}
    >
      {children}
    </select>
  );
}

export function Textarea({
  compact,
  invalid,
  className = "",
  ...props
}: NativeTextarea & { compact?: boolean; invalid?: boolean }) {
  return (
    <textarea
      {...props}
      className={cn(FIELD_BASE, compact ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm", invalid && FIELD_INVALID, className)}
    />
  );
}

/** Label + control + hint/error. Wrap one control so the label is clickable and announced. */
export function Field({
  label,
  hint,
  error,
  children,
  className = "",
  required,
  inline,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  required?: boolean;
  /** Label and control side by side (for short controls in a settings row). */
  inline?: boolean;
}) {
  return (
    <label className={cn("flex min-w-0 gap-1", inline ? "flex-row items-center justify-between gap-3" : "flex-col", className)}>
      <span className="text-xs font-medium text-text-muted">
        {label}
        {required && <span className="text-bad"> *</span>}
      </span>
      {children}
      {error ? (
        <span className="text-xs text-bad">{error}</span>
      ) : hint ? (
        <span className="text-xs text-text-faint">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * A caption and hint around a row of buttons (Segmented). Not a <label>: a
 * label hands its clicks to the first button inside, so clicking the caption
 * would press it (review, 2026-09-28). The Segmented's own aria-label names
 * the group for screen readers.
 */
export function FieldGroup({ label, hint, children, className = "" }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-xs font-medium text-text-muted">{label}</span>
      {children}
      {hint ? <span className="text-xs text-text-faint">{hint}</span> : null}
    </div>
  );
}

/** Whose turn (or any one-word status), as a coloured dot and a label: "● Your turn". */
export function TurnDot({ tone, children, title }: { tone: "warn" | "muted" | "info" | "good" | "bad"; children: ReactNode; title?: string }) {
  const dot = { warn: "bg-warn", muted: "bg-border-strong", info: "bg-info", good: "bg-good-strong", bad: "bg-bad" }[tone];
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-text-muted" title={title}>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} aria-hidden />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Visually-hidden text for screen readers. */
export function SrOnly({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

/**
 * A checkbox for row selection. `indeterminate` shows "some selected" on a
 * select-all box. Use it inside client components (the indeterminate state
 * is set through a ref on the DOM node).
 */
export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  indeterminate?: boolean;
  /** `shiftKey`: a shift-click, for ticking a range. */
  onChange: (checked: boolean, how: { shiftKey: boolean }) => void;
  /** Screen-reader label — required, the box has no visible text. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="checkbox"
      ref={(el) => {
        if (el) el.indeterminate = indeterminate && !checked;
      }}
      checked={checked}
      disabled={disabled}
      // A click (or Space) carries shiftKey; onChange alone doesn't.
      onClick={(e) => onChange(e.currentTarget.checked, { shiftKey: e.shiftKey })}
      onChange={() => {}}
      aria-label={label}
      className="h-4 w-4 cursor-pointer rounded border-border-strong accent-accent disabled:cursor-not-allowed"
    />
  );
}
