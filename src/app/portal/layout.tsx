import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, LogOut } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui";
import { PortalTabs } from "@/components/portal-tabs";
import { getPortalContext, getPortalCreators } from "@/lib/portal-data";
import { signOutAction } from "@/app/actions";

export const metadata: Metadata = { title: "Creator program" };

/**
 * The client portal: one brand's creators, for the people at that brand —
 * see where everyone is, approve creators, ship product. A teammate can open
 * it too ("See what the client sees"): shown exactly, nothing saved.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/login");
  const creators = await getPortalCreators(ctx.clientId);
  const toApprove = creators.filter((c) => c.clientApproval === "pending" && c.stage === "shortlisted").length;
  const toShip = creators.filter((c) => c.stage === "fulfilling").length;

  return (
    <div className="min-h-screen bg-bg">
      {ctx.readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-info-line bg-info-soft px-4 py-2 text-xs text-info sm:px-6">
          <span>
            You&apos;re seeing {ctx.clientName}&apos;s portal exactly as they do. Nothing can be changed from here.
          </span>
          <Link href="/settings#client-team" className="inline-flex items-center gap-1 font-medium underline">
            <ArrowLeft size={12} /> Back to Creator Manager
          </Link>
        </div>
      )}
      <header className="border-b border-sidebar-line bg-sidebar-bg px-4 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-3">
            <BrandMark size={28} />
            <div>
              <div className="text-sm font-semibold text-white">{ctx.clientName} · Creator program</div>
              <div className="text-xs text-sidebar-muted">Run with Sentic</div>
            </div>
          </div>
          {!ctx.readOnly && (
            <form action={signOutAction}>
              <Button type="submit" size="sm" variant="ghost" icon={<LogOut size={13} />} className="text-sidebar-text hover:text-white">
                Sign out
              </Button>
            </form>
          )}
        </div>
        <div className="mx-auto max-w-5xl">
          <PortalTabs toApprove={toApprove} toShip={toShip} />
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">{children}</main>
    </div>
  );
}
