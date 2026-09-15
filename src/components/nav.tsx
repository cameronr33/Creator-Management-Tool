"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Send,
  Kanban,
  Megaphone,
  Upload,
  Settings,
  CircleHelp,
  type LucideIcon,
} from "lucide-react";

/**
 * Ordered the way a day goes: what's stuck → send what's due → see the
 * funnel → look someone up. Setup lives under its own heading so a new
 * teammate can tell daily work from one-time configuration.
 */
const SECTIONS: { label: string; links: { href: string; label: string; icon: LucideIcon; exact?: boolean }[] }[] = [
  {
    label: "Work",
    links: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { href: "/outreach", label: "Outreach", icon: Send },
      { href: "/pipeline", label: "Pipeline", icon: Kanban },
      { href: "/creators", label: "Creators", icon: Users },
    ],
  },
  {
    label: "Manage",
    links: [
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/import", label: "Import research", icon: Upload },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
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
      {badge != null && badge > 0 && (
        <span className="rounded-full bg-brand-lime px-1.5 py-0.5 text-[11px] font-semibold tabular text-brand-navy">
          {badge}
        </span>
      )}
    </Link>
  );
}

export function Nav({ settingsBadge }: { settingsBadge?: number }) {
  return (
    <nav className="flex flex-col gap-5">
      {SECTIONS.map((section) => (
        <div key={section.label}>
          <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
            {section.label}
          </div>
          <div className="flex flex-col gap-0.5">
            {section.links.map((l) => (
              <NavLink key={l.href} {...l} badge={l.href === "/settings" ? settingsBadge : undefined} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function HelpNavLink() {
  return <NavLink href="/help" label="How it works" icon={CircleHelp} />;
}
