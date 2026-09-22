"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CREATOR_SECTIONS, creatorSectionHref, type CreatorSection } from "@/lib/creator-workspace";

/** Preserve existing links such as /creators/id#shipping after adding sections. */
export function CreatorHashNavigation({ id, section, returnTo }: { id: string; section: CreatorSection; returnTo?: string }) {
  const router = useRouter();
  useEffect(() => {
    const followHash = () => {
      const target = CREATOR_SECTIONS.find((item) => `#${item.value}` === window.location.hash);
      if (target && target.value !== section) router.replace(creatorSectionHref(id, target.value, returnTo));
    };
    followHash();
    window.addEventListener("hashchange", followHash);
    return () => window.removeEventListener("hashchange", followHash);
  }, [id, section, returnTo, router]);
  return null;
}
