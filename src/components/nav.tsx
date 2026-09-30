"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Kanban, Settings, CircleHelp, type LucideIcon } from "lucide-react";

/**
 * Four places, in the order a day goes: what needs you (Today), where every
 * deal stands (Pipeline), the list you manage (Creators), one-time setup
 * (Settings). Everything else was cut on purpose — see README "Design system".
 */
const LINKS: { href: string; label: string; icon: LucideIcon; exact?: boolean }[] = [
  { href: "/", label: "Today", icon: LayoutDashboard, exact: true },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/creators", label: "Creators", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function NavLink({
  href,
  label,
  icon: Icon,
  exact,
  badge,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  badge?: number;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition ${
        active
          ? "bg-sidebar-active-bg text-sidebar-active"
          : "text-sidebar-text hover:bg-sidebar-hover-bg hover:text-white"
      }`}
    >
      {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-sidebar-active" />}
      <Icon size={17} strokeWidth={2} />
      <span className="flex-1">{label}</span>
      <LinkHint />
      {badge != null && badge > 0 && (
        <span className="rounded-full bg-brand-lime px-1.5 py-0.5 text-[11px] font-semibold tabular text-brand-navy">
          {badge}
        </span>
      )}
    </Link>
  );
}

/**
 * A small dot that pulses while the page you clicked is on its way — always
 * there, only its opacity changes, so nothing shifts (interaction review 2026-09-30).
 */
function LinkHint() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`h-1.5 w-1.5 rounded-full bg-sidebar-active transition-opacity ${pending ? "animate-pulse opacity-100" : "opacity-0"}`} />;
}

export function Nav() {
  return (
    <nav className="flex flex-col gap-0.5">
      {LINKS.map((l) => (
        <NavLink key={l.href} {...l} />
      ))}
    </nav>
  );
}

export function HelpNavLink() {
  return <NavLink href="/help" label="How it works" icon={CircleHelp} />;
}
