"use client";

import { useOptimistic } from "react";
import { Segmented } from "@/components/ui";
import { selectView } from "@/app/actions";
import { useMainPending } from "@/components/main-pending";

/**
 * Mine / Everyone on Today, Pipeline and Creators. Mine shows your deals plus
 * unassigned ones, so nothing falls through; the choice is remembered. The
 * toggle moves the moment you press it; the page dims until the list is back.
 */
export function MineToggle({ view }: { view: "mine" | "all" }) {
  const { start } = useMainPending();
  const [shown, setShown] = useOptimistic(view);
  return (
    <Segmented<"mine" | "all">
      aria-label="Whose creators to show"
      value={shown}
      onChange={(v) =>
        v !== shown &&
        start(async () => {
          setShown(v);
          await selectView(v);
        })
      }
      options={[
        { value: "mine", label: "Mine", title: "Yours and unassigned" },
        { value: "all", label: "Everyone", title: "The whole team's" },
      ]}
    />
  );
}
