"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui";
import { api, useSave } from "@/components/use-save";

/** "Mark done" on our side's open promise, with Undo (src/lib/promise-answer.ts). */
export function PromiseDoneButton({ partnershipId, name }: { partnershipId: string; name: string }) {
  const { pending, run, undoVia } = useSave();
  const url = `/api/partnerships/${partnershipId}/promise`;
  return (
    <Button
      size="sm"
      icon={<Check size={13} />}
      pending={pending}
      title="We did what we said — take it off this list"
      onClick={() =>
        run(() => api<{ doneAt?: string }>(url, { action: "done" }), {
          success: `Done — what we promised ${name} is off the list`,
          undoWith: (d) => (typeof d.doneAt === "string" ? () => void undoVia(url, { action: "undo", doneAt: d.doneAt }, `Undone — the promise to ${name} is back`) : null),
        })
      }
    >
      Mark done
    </Button>
  );
}
