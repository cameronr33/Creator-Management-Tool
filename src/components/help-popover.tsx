"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";

/**
 * The page header's "?": how this page works, in a pop-up that closes on a
 * click anywhere else or Escape (it used to stay open until you clicked "?"
 * again — interaction review 2026-09-30, I11). Focus goes back to "?".
 */
export function HelpPopover({ help, helpAnchor }: { help: string; helpAnchor?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-label="How this page works"
        title="How this page works"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-text-faint transition hover:bg-surface-2 hover:text-accent"
      >
        <CircleHelp size={15} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="How this page works"
          className="absolute left-0 z-20 mt-1 w-80 max-w-[calc(100vw-2rem)] animate-pop-in rounded-lg border border-border bg-surface p-3 text-[13px] leading-relaxed text-text-muted shadow-float"
        >
          {help}
          {helpAnchor && (
            <Link href={`/help#${helpAnchor}`} className="mt-1.5 block font-medium text-accent hover:underline">
              Full guide →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
