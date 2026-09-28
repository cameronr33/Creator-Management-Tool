"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useReducer } from "react";
import { stagesByGroup } from "@/lib/stages";
import { Field, Input, Select, Button } from "@/components/ui";
import { searchDraft } from "@/lib/search-draft";

/** Drop the list filters from a query string, keeping anything else. */
export function clearListFilters(query: string): string {
  const next = new URLSearchParams(query);
  for (const key of ["q", "stage"]) next.delete(key);
  return next.toString();
}

/**
 * Search and stage filter for the Creators list. The campaign is not here:
 * it's the sidebar's campaign scope, shared by every page.
 */
export function CreatorsFilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const [search, updateSearch] = useReducer(searchDraft, { draft: urlQ, url: urlQ, pending: [] });
  if (search.url !== urlQ) updateSearch({ type: "url", value: urlQ });
  const q = search.draft;
  const setQ = (value: string) => updateSearch({ type: "edit", value });

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      const qs = next.toString();
      if (key === "q") updateSearch({ type: "submit", value });
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [params, pathname, router],
  );

  const stage = params.get("stage") ?? "";

  // Typing updates the box immediately; the URL (and the server round-trip)
  // follows 300ms after the last keystroke instead of on every key.
  useEffect(() => {
    const t = setTimeout(() => {
      if (q !== urlQ) setParam("q", q);
    }, 300);
    return () => clearTimeout(t);
  }, [q, urlQ, setParam]);

  const hasFilters = urlQ || stage;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Find a creator">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-faint" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search creators"
            title="Search by name, handle or content type"
            aria-label="Search creators"
            className="w-64 pl-8"
          />
        </div>
      </Field>

      <Field label="Stage">
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
      </Field>

      {hasFilters && (
        <Button
          variant="ghost"
          icon={<X size={14} />}
          onClick={() => {
            setQ("");
            updateSearch({ type: "submit", value: "" });
            const query = clearListFilters(params.toString());
            router.push(query ? `${pathname}?${query}` : pathname);
          }}
        >
          Clear
        </Button>
      )}
    </div>
  );
}
