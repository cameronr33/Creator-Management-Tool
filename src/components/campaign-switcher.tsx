"use client";

import Link from "next/link";
import { useMainPending } from "@/components/main-pending";
import { ChoiceMenu } from "@/components/menu";
import { SIDEBAR_SWITCH } from "@/components/client-switcher";
import { selectCampaign } from "@/app/actions";

/**
 * Under the client: which campaign Today, Pipeline and Creators show.
 * "All campaigns" is the default; every page header repeats the choice so
 * a filtered view is never mistaken for the whole list. A menu, not a
 * dropdown, so arrowing through it never reloads the page at each step (R10).
 */
export function CampaignSwitcher({
  campaigns,
  activeId,
}: {
  campaigns: { id: string; name: string }[];
  activeId: string | null;
}) {
  const { pending, start } = useMainPending();
  return (
    <div className="space-y-1">
      <ChoiceMenu<string>
        label="Campaign"
        value={activeId ?? ""}
        pending={pending}
        triggerClassName={SIDEBAR_SWITCH}
        options={[{ value: "", label: "All campaigns" }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))]}
        onChoose={(id) => {
          const name = id ? (campaigns.find((c) => c.id === id)?.name ?? "the campaign") : "All campaigns";
          const data = new FormData();
          data.set("campaign", id);
          start(() => selectCampaign(data), { label: `Showing ${name}…` });
        }}
      />
      <Link href="/settings#campaigns" className="block px-1 text-[11px] text-sidebar-muted hover:text-white">
        Manage campaigns
      </Link>
    </div>
  );
}
