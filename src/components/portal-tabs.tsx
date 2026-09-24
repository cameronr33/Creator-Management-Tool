"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";

/** The portal's four places. The counts are what's waiting on the client. */
export function PortalTabs({ toApprove, toShip }: { toApprove: number; toShip: number }) {
  const path = usePathname();
  const tabs = [
    { href: "/portal", label: "Overview", count: 0 },
    { href: "/portal/approve", label: "Approve creators", count: toApprove },
    { href: "/portal/ship", label: "Ship product", count: toShip },
    { href: "/portal/creators", label: "All creators", count: 0 },
  ];
  return (
    <nav aria-label="Portal" className="-mb-px flex gap-1 overflow-x-auto">
      {tabs.map((t) => {
        const on = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition",
              on ? "border-brand-lime text-white" : "border-transparent text-sidebar-muted hover:text-white",
            )}
          >
            {t.label}
            {t.count > 0 && <span className="rounded-full bg-brand-lime px-1.5 text-[11px] font-semibold tabular text-brand-navy">{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
