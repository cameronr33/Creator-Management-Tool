"use client";

import { useRef } from "react";
import { selectClient } from "@/app/actions";
import type { ActiveClient } from "@/lib/queries";

/**
 * The one control that decides whose data every page shows. It sits under
 * a visible "Client" label in the sidebar, and every page header repeats
 * the client name, so working in the wrong client's data is hard to miss.
 */
export function ClientSwitcher({
  clients,
  activeSlug,
}: {
  clients: ActiveClient[];
  activeSlug: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  if (clients.length === 0) {
    return (
      <div className="rounded-md border border-sidebar-line bg-sidebar-bg-2 px-3 py-2 text-sm text-sidebar-muted">
        No clients yet
      </div>
    );
  }

  return (
    <form ref={formRef} action={selectClient}>
      <select
        name="slug"
        defaultValue={activeSlug}
        onChange={() => formRef.current?.requestSubmit()}
        className="select-chevron-light h-9 w-full appearance-none rounded-md border border-sidebar-line bg-sidebar-bg-2 pl-3 pr-8 text-sm font-medium text-white transition hover:border-white/20 focus:border-brand-lime focus-visible:outline-none"
        aria-label="Active client"
      >
        {clients.map((c) => (
          <option key={c.id} value={c.slug} className="text-text">
            {c.name}
          </option>
        ))}
      </select>
    </form>
  );
}
