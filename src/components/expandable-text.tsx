"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * A long logged message, clipped at six lines with "Show all" to read the
 * rest (interface review 2026-09-30, R5): a DM or a note logged by hand has
 * no "Open the email" link, so past line six it couldn't be read at all.
 * The button only appears when the text is actually clipped.
 */
export function ExpandableText({ text, className = "" }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, text]);
  return (
    <div>
      <p ref={ref} className={`whitespace-pre-wrap break-words ${open ? "" : "line-clamp-[6]"} ${className}`}>
        {text}
      </p>
      {(clipped || open) && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-0.5 text-xs font-medium text-accent hover:underline">
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}
