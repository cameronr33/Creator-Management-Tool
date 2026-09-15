"use client";

import { useState, type ReactNode } from "react";
import { Button, IconButton, type ButtonSize } from "@/components/ui";

/**
 * Two-step destructive action: the first click turns into "Sure? Yes / No"
 * in place, so a misclick on Revoke / Disconnect / Remove costs nothing.
 * Nothing in the app used to confirm anything.
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
  const [arming, setArming] = useState(false);

  if (arming) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs text-text-muted ${className}`}>
        <span>{question}</span>
        <Button
          size="sm"
          variant="danger"
          pending={pending}
          onClick={async () => {
            await onConfirm();
            setArming(false);
          }}
        >
          {confirmLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setArming(false)}>
          No
        </Button>
      </span>
    );
  }

  if (iconOnly && icon) {
    return (
      <IconButton
        label={label}
        icon={icon}
        variant="danger"
        disabled={disabled}
        pending={pending}
        onClick={() => setArming(true)}
        className={className}
      />
    );
  }

  return (
    <Button
      size={size}
      variant="danger"
      icon={icon}
      disabled={disabled}
      pending={pending}
      onClick={() => setArming(true)}
      className={className}
    >
      {label}
    </Button>
  );
}
