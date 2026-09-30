"use client";

import { useMainPending } from "@/components/main-pending";
import { ChoiceMenu } from "@/components/menu";
import { selectClient } from "@/app/actions";
import type { ActiveClient } from "@/lib/queries";

/** The navy sidebar's switchers: a field on the dark ground, edge 3.1:1 (interface review 2026-09-30, R15). */
export const SIDEBAR_SWITCH =
  "inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border border-sidebar-field-edge bg-sidebar-bg-2 px-3 text-left text-sm font-medium text-white transition hover:border-white/50 disabled:opacity-60";

/**
 * The one control that decides whose data every page shows. It sits under
 * a visible "Client" label in the sidebar, and every page header repeats
 * the client name, so working in the wrong client's data is hard to miss.
 * A menu, not a dropdown: arrowing through a closed dropdown would switch
 * client at every step (R10).
 */
export function ClientSwitcher({
  clients,
  activeSlug,
}: {
  clients: ActiveClient[];
  activeSlug: string;
}) {
  const { pending, start } = useMainPending();

  if (clients.length === 0) {
    return (
      <div className="rounded-md border border-sidebar-line bg-sidebar-bg-2 px-3 py-2 text-sm text-sidebar-muted">
        No clients yet
      </div>
    );
  }

  return (
    <ChoiceMenu<string>
      label="Active client"
      value={activeSlug}
      pending={pending}
      triggerClassName={SIDEBAR_SWITCH}
      options={clients.map((c) => ({ value: c.slug, label: c.name }))}
      onChoose={(slug) => {
        const name = clients.find((c) => c.slug === slug)?.name ?? "the client";
        const data = new FormData();
        data.set("slug", slug);
        start(() => selectClient(data), { label: `Switching to ${name}…` });
      }}
    />
  );
}
