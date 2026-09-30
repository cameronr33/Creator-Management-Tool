"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, IconButton, type ButtonSize } from "@/components/ui";

/** How long "Sure?" waits before it quietly goes back. */
const DISARM_MS = 8_000;

/**
 * Two-step destructive action: the first click turns into "Sure? Yes / No"
 * in place, so a misclick on Revoke / Disconnect / Remove costs nothing.
 * Nothing in the app used to confirm anything.
 *
 * Interaction review 2026-09-30 (I13): the keyboard lands on the safe No,
 * Escape cancels, and the question goes back by itself after a few seconds
 * (focus returns to the button if it was on the question).
 */
export function ConfirmButton({
  label,
  confirmLabel = "Yes, do it",
  question = "Are you sure?",
  onConfirm,
  icon,
  size = "sm",
  pending,
  disabled,
  iconOnly = false,
  className = "",
}: {
  label: string;
  confirmLabel?: string;
  question?: string;
  onConfirm: () => void | Promise<unknown>;
  icon?: ReactNode;
  size?: ButtonSize;
  pending?: boolean;
  disabled?: boolean;
  /** Render the resting state as an icon-only button (label becomes the tooltip). */
  iconOnly?: boolean;
  className?: string;
}) {
  const [armedAt, setArmedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [refocus, setRefocus] = useState(false);
  const armRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (armedAt === null) return;
    const timer = setInterval(() => {
      const t = Date.now();
      if (t - armedAt < DISARM_MS) return setNow(t);
      setRefocus(!!armRef.current?.contains(document.activeElement));
      setArmedAt(null);
    }, 500);
    return () => clearInterval(timer);
  }, [armedAt]);

  const cancel = () => {
    setRefocus(true);
    setArmedAt(null);
  };

  if (armedAt !== null) {
    const secondsLeft = Math.max(1, Math.ceil((DISARM_MS - (Math.max(now, armedAt) - armedAt)) / 1000));
    return (
      <span
        ref={armRef}
        className={`inline-flex flex-wrap items-center gap-1.5 text-xs text-text-muted ${className}`}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            cancel();
          }
        }}
      >
        <span>{question}</span>
        <Button
          size="sm"
          variant="danger"
          pending={pending}
          onClick={async () => {
            await onConfirm();
            setArmedAt(null);
          }}
        >
          {confirmLabel}
        </Button>
        <Button size="sm" variant="ghost" autoFocus onClick={cancel}>
          No
        </Button>
        <span className="text-text-faint" aria-live="off">
          Cancels in {secondsLeft}s
        </span>
      </span>
    );
  }

  const arm = () => {
    setNow(0);
    setArmedAt(Date.now());
  };

  if (iconOnly && icon) {
    return (
      <IconButton
        label={label}
        icon={icon}
        variant="danger"
        disabled={disabled}
        pending={pending}
        onClick={arm}
        className={className}
      />
    );
  }

  return (
    <Button size={size} variant="danger" icon={icon} disabled={disabled} pending={pending} onClick={arm} className={className} autoFocus={refocus}>
      {label}
    </Button>
  );
}
