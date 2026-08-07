import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { auth } from "@/lib/auth";
import { getClients, resolveClient } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { Nav } from "@/components/nav";
import { ClientSwitcher } from "@/components/client-switcher";
import { signOutAction } from "@/app/actions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const clients = await getClients();
  const active = await resolveClient(await getSelectedClientSlug());

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col gap-4 border-r border-border bg-surface px-3 py-4">
        <div className="px-2">
          <div className="text-sm font-semibold text-text">Creator Manager</div>
          <div className="text-xs text-text-faint">Relationship tracker</div>
        </div>

        <ClientSwitcher clients={clients} activeSlug={active?.slug ?? ""} />

        <div className="flex-1">
          <Nav />
        </div>

        <div className="border-t border-border pt-3">
          <div className="px-2 pb-2 text-xs text-text-muted">
            {session.user.name ?? session.user.email}
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-text-muted transition hover:bg-surface-2 hover:text-text"
            >
              <LogOut size={17} />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
