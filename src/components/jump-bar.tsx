"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui";

/**
 * The creator page's "Jump to" links, pinned under the header as you scroll
 * (interaction review 2026-09-30, I12): the section you're in is marked, a
 * click scrolls there smoothly (instantly when the computer asks for reduced
 * motion), and a soft shadow appears once sections scroll under it (S9).
 */
export function JumpBar({ sections }: { sections: { id: string; label: string }[] }) {
  const bar = useRef<HTMLElement>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  const ids = sections.map((s) => s.id).join(",");

  useEffect(() => {
    const list = ids.split(",");
    const onScroll = () => {
      const el = bar.current;
      if (!el) return;
      setStuck(el.getBoundingClientRect().top <= 0.5 && window.scrollY > 0);
      const reach = el.offsetHeight + 24;
      let cur: string | null = null;
      for (const id of list) {
        const section = document.getElementById(id);
        if (section && section.getBoundingClientRect().top - reach <= 0) cur = id;
      }
      // At the very bottom, the last section is the one you're reading.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) cur = list[list.length - 1] ?? cur;
      setCurrent(cur);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ids]);

  return (
    <nav
      ref={bar}
      aria-label="Jump to"
      className={cn(
        "sticky top-0 z-20 flex flex-wrap gap-x-5 border-b border-border bg-surface/95 px-4 text-sm backdrop-blur transition-shadow duration-(--duration-quick) sm:px-6",
        stuck && "shadow-control",
      )}
    >
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          aria-current={current === s.id ? "location" : undefined}
          onClick={(e) => {
            const target = document.getElementById(s.id);
            if (!target) return;
            e.preventDefault();
            const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
            history.replaceState(null, "", `#${s.id}`);
          }}
          className={cn(
            "-mb-px border-b-2 py-2.5 transition-colors",
            current === s.id ? "border-accent font-medium text-accent" : "border-transparent text-text-muted hover:text-accent",
          )}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
