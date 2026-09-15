"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { stagesByGroup } from "@/lib/stages";
import { Input, Select, Button } from "@/components/ui";

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
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [params, pathname, router],
  );

  const urlQ = params.get("q") ?? "";
  const stage = params.get("stage") ?? "";
  const campaign = params.get("campaign") ?? "";

  // Typing updates the box immediately; the URL (and the server round-trip)
  // follows 300ms after the last keystroke instead of on every key.
  const [q, setQ] = useState(urlQ);
  useEffect(() => {
    const t = setTimeout(() => {
      if (q !== urlQ) setParam("q", q);
    }, 300);
    return () => clearTimeout(t);
  }, [q, urlQ, setParam]);

  const hasFilters = urlQ || stage || campaign;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-faint" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, handle, content type…"
          aria-label="Search creators"
          className="w-64 pl-8"
        />
      </div>

      <Select value={campaign} onChange={(e) => setParam("campaign", e.target.value)} aria-label="Campaign" className="w-44">
        <option value="">All campaigns</option>
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>

      <Select value={stage} onChange={(e) => setParam("stage", e.target.value)} aria-label="Stage" className="w-44">
        <option value="">All stages</option>
        {stagesByGroup().map((g) => (
          <optgroup key={g.group} label={g.label}>
            {g.stages.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>

      {hasFilters && (
        <Button
          variant="ghost"
          icon={<X size={14} />}
          onClick={() => {
            setQ("");
            router.push(pathname);
          }}
        >
          Clear
        </Button>
      )}
    </div>
  );
}
