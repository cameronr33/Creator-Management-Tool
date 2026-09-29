"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * "Back" to wherever you came from inside the app — or to Today when the
 * page was opened on its own (a new tab, a bookmark), where going back would
 * leave the app (run-through, 2026-09-29: no way back from Help).
 */
export function BackLink({ fallback = "/", label = "Back" }: { fallback?: string; label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        let fromHere = false;
        try {
          fromHere = !!document.referrer && new URL(document.referrer).origin === window.location.origin;
        } catch {
          fromHere = false;
        }
        if (fromHere && window.history.length > 1) router.back();
        else router.push(fallback);
      }}
      className="mb-2 inline-flex items-center gap-1 text-sm text-text-muted transition hover:text-accent"
    >
      <ArrowLeft size={14} /> {label}
    </button>
  );
}
