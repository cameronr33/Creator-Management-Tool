import Link from "next/link";
import type { ReactNode } from "react";
import type { CmStage } from "@/lib/db/schema";
import { stageLabel, stageStyle } from "@/lib/stages";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold text-text">{title}</h1>
        {subtitle && <p className="text-sm text-text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-surface ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide text-text-faint">
      {children}
    </h2>
  );
}

export function StagePill({ stage }: { stage: CmStage }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${stageStyle(stage)}`}
    >
      {stageLabel(stage)}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warn" | "good" | "bad" | "muted";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-surface-2 text-text-muted ring-border",
    accent: "bg-accent-soft text-accent ring-indigo-200",
    warn: "bg-amber-50 text-amber-800 ring-amber-200",
    good: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    bad: "bg-red-50 text-red-700 ring-red-200",
    muted: "bg-surface-2 text-text-faint ring-border",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Avatar({ name }: { name: string }) {
  const label = name
    .trim()
    .split(/[\s&/]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
      {label || "?"}
    </span>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center">
      <p className="text-sm font-medium text-text">{title}</p>
      {hint && <p className="max-w-md text-sm text-text-muted">{hint}</p>}
      {action}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  href,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  href?: string;
  tone?: "neutral" | "warn" | "accent";
}) {
  const ring =
    tone === "warn"
      ? "ring-amber-200"
      : tone === "accent"
        ? "ring-indigo-200"
        : "ring-border";
  const inner = (
    <div className={`rounded-xl border-0 bg-surface p-4 ring-1 ring-inset ${ring} transition hover:ring-border-strong`}>
      <div className="text-xs font-medium uppercase tracking-wide text-text-faint">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular text-text">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-text-muted">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
