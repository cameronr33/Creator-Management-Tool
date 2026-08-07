"use client";

import { useRef } from "react";
import { ChevronsUpDown } from "lucide-react";
import { selectClient } from "@/app/actions";
import type { ActiveClient } from "@/lib/queries";

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
      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-faint">
        No clients yet
      </div>
    );
  }

  return (
    <form ref={formRef} action={selectClient} className="relative">
      <select
        name="slug"
        defaultValue={activeSlug}
        onChange={() => formRef.current?.requestSubmit()}
        className="w-full appearance-none rounded-lg border border-border bg-surface px-3 py-2 pr-8 text-sm font-medium text-text outline-none transition hover:border-border-strong focus:border-accent"
        aria-label="Active client"
      >
        {clients.map((c) => (
          <option key={c.id} value={c.slug}>
            {c.name}
          </option>
        ))}
      </select>
      <ChevronsUpDown
        size={15}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-faint"
      />
    </form>
  );
}
