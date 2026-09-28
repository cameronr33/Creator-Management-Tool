"use client";

import { useTransition } from "react";
import { Segmented } from "@/components/ui";
import { selectView } from "@/app/actions";

/**
 * Mine / Everyone on Today, Pipeline and Creators. Mine shows your deals plus
 * unassigned ones, so nothing falls through; the choice is remembered.
 */
export function MineToggle({ view }: { view: "mine" | "all" }) {
  const [pending, start] = useTransition();
  return (
    <Segmented<"mine" | "all">
      aria-label="Whose creators to show"
      value={view}
      disabled={pending}
      onChange={(v) => start(() => selectView(v))}
      options={[
        { value: "mine", label: "Mine", title: "Yours and unassigned" },
        { value: "all", label: "Everyone", title: "The whole team's" },
      ]}
    />
  );
}
