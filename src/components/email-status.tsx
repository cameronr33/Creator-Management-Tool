"use client";

import { RotateCcw, ScanText, CircleSlash, Check } from "lucide-react";
import { Button } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { api, useSave } from "@/components/use-save";

/**
 * The buttons that go with reading the latest email. Every automatic move
 * can be taken back, a "no" is only ever closed by a person, and a reply
 * that needs no answer can be cleared from Today.
 */

export function UndoMoveButton({ partnershipId, transitionId }: { partnershipId: string; transitionId: string }) {
  const { pending, run } = useSave();
  return (
    <Button
      size="sm"
      variant="link"
      icon={<RotateCcw size={12} />}
      pending={pending}
      onClick={() => run(() => api(`/api/partnerships/${partnershipId}/undo`, { transitionId }), { success: "Move undone" })}
    >
      Undo
    </Button>
  );
}

export function RereadEmailsButton({ partnershipId }: { partnershipId: string }) {
  const { pending, run } = useSave();
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<ScanText size={13} />}
      pending={pending}
      title="Reads this conversation again and updates the summary and stage"
      onClick={() => run(() => api(`/api/partnerships/${partnershipId}/assess`), { success: "Emails re-read" })}
    >
      {pending ? "Reading…" : "Re-read emails"}
    </Button>
  );
}

export function CloseAsDeclinedButton({ partnershipId }: { partnershipId: string }) {
  const { pending, run } = useSave();
  return (
    <ConfirmButton
      label="Close as They declined"
      icon={<CircleSlash size={13} />}
      question="Close this deal as They declined?"
      confirmLabel="Close it"
      pending={pending}
      onConfirm={() =>
        run(() => api(`/api/partnerships/${partnershipId}/stage`, { stage: "declined", exitReason: "not_interested" }), {
          success: "Closed as They declined",
        })
      }
    />
  );
}

export function NoReplyNeededButton({ partnershipId }: { partnershipId: string }) {
  const { pending, run } = useSave();
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<Check size={13} />}
      pending={pending}
      title="Clears this from Your turn until they write again"
      onClick={() => run(() => api(`/api/partnerships/${partnershipId}/reply-handled`), { success: "Marked as no reply needed" })}
    >
      No reply needed
    </Button>
  );
}
