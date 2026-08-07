"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X } from "lucide-react";
import { useCallback } from "react";
import { STAGES } from "@/lib/stages";

export function CreatorsFilterBar({
  campaigns,
}: {
  campaigns: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const q = params.get("q") ?? "";
  const stage = params.get("stage") ?? "";
  const campaign = params.get("campaign") ?? "";
  const hasFilters = q || stage || campaign;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
        <input
          defaultValue={q}
          onChange={(e) => setParam("q", e.target.value)}
          placeholder="Search name, handle, pillar…"
          className="w-64 rounded-lg border border-border bg-surface py-2 pl-8 pr-3 text-sm outline-none focus:border-accent"
        />
      </div>

      <select
        value={campaign}
        onChange={(e) => setParam("campaign", e.target.value)}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      >
        <option value="">All campaigns</option>
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <select
        value={stage}
        onChange={(e) => setParam("stage", e.target.value)}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      >
        <option value="">All stages</option>
        {STAGES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      {hasFilters && (
        <button
          onClick={() => router.push(pathname)}
          className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-sm text-text-muted transition hover:bg-surface-2"
        >
          <X size={14} /> Clear
        </button>
      )}
    </div>
  );
}
