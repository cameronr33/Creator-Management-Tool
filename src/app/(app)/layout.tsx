import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { auth } from "@/lib/auth";
import { getClients, resolveClient } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { countOpenSuggestions } from "@/lib/email-suggestions";
import { Nav, HelpNavLink } from "@/components/nav";
import { ClientSwitcher } from "@/components/client-switcher";
import { BrandLockup } from "@/components/brand";
import { Toaster } from "@/components/toast";
import { signOutAction } from "@/app/actions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [clients, active, unmatchedSenders] = await Promise.all([
    getClients(),
    resolveClient(await getSelectedClientSlug()),
    countOpenSuggestions(),
  ]);

  return (
    <div className="flex min-h-screen">
      <aside className="sidebar-scroll sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-sidebar-line bg-sidebar-bg">
        <div className="px-4 pt-5 pb-4">
          <BrandLockup inverted />
        </div>

        <div className="px-3">
          <div className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
            Client
          </div>
          <ClientSwitcher clients={clients} activeSlug={active?.slug ?? ""} />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-5">
          <Nav settingsBadge={unmatchedSenders} />
        </div>

        <div className="border-t border-sidebar-line px-3 py-3">
          <HelpNavLink />
          <div className="mt-2 flex items-center justify-between gap-2 px-3">
            <span className="min-w-0 truncate text-xs text-sidebar-muted" title={session.user.email ?? undefined}>
              {session.user.name ?? session.user.email}
            </span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-sidebar-muted transition hover:bg-sidebar-hover-bg hover:text-white"
                title="Sign out"
              >
                <LogOut size={14} />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
      <Toaster />
    </div>
  );
}
