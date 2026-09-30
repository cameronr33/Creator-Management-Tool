"use client";

import Link from "next/link";
import { useRef } from "react";
import { useMainPending } from "@/components/main-pending";
import { selectCampaign } from "@/app/actions";

/**
 * Under the client: which campaign Today, Pipeline and Creators show.
 * "All campaigns" is the default; every page header repeats the choice so
 * a filtered view is never mistaken for the whole list.
 */
export function CampaignSwitcher({
  campaigns,
  activeId,
}: {
  campaigns: { id: string; name: string }[];
  activeId: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const { pending, start } = useMainPending();
  return (
    <div className="space-y-1">
      <form ref={formRef} action={selectCampaign}>
        <select
          name="campaign"
          defaultValue={activeId ?? ""}
          key={activeId ?? "all"}
          disabled={pending}
          onChange={(e) => {
            const form = formRef.current;
            if (!form) return;
            const name = e.target.selectedOptions[0]?.textContent ?? "the campaign";
            const data = new FormData(form);
            start(() => selectCampaign(data), { label: `Showing ${name}…` });
          }}
          className="select-chevron-light h-9 w-full appearance-none rounded-md border border-sidebar-line bg-sidebar-bg-2 pl-3 pr-8 text-sm font-medium text-white transition hover:border-white/20 focus:border-brand-lime focus-visible:outline-none disabled:opacity-60"
          aria-label="Campaign"
        >
          <option value="">
            All campaigns
          </option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </form>
      <Link href="/settings#campaigns" className="block px-1 text-[11px] text-sidebar-muted hover:text-white">
        Manage campaigns
      </Link>
    </div>
  );
}
