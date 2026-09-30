"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { api, useSave } from "@/components/use-save";

/**
 * Approve or pass on a creator before outreach. The agency (on the client's
 * behalf) and the client portal use the same control; only where it posts
 * differs. Passing asks for an optional reason and closes the deal.
 */
export function ApprovalButtons({
  partnershipId,
  name,
  who,
  readOnly = false,
}: {
  partnershipId: string;
  name: string;
  /** "agency" posts to the partnership; "client" to the portal's own endpoint. */
  who: "agency" | "client";
  /** "See what the client sees": shown, but nothing is saved. */
  readOnly?: boolean;
}) {
  const { pending, run, undoVia } = useSave();
  const [passing, setPassing] = useState(false);
  const [note, setNote] = useState("");
  const url = who === "agency" ? `/api/partnerships/${partnershipId}/approval` : "/api/client/approve";
  const base = who === "agency" ? {} : { partnershipId };

  // Undo takes your own decision back within ten minutes (interaction review 2026-09-30).
  const decide = (decision: "approve" | "pass") =>
    run(() => api(url, { ...base, decision, note: note || undefined }), {
      success: decision === "approve" ? `${name} approved` : `Passed on ${name}`,
      undoWith: (d) => {
        if (decision === "approve") {
          return typeof d.decidedAt === "string" ? () => void undoVia(url, { ...base, decision: "undo_approve", decidedAt: d.decidedAt }, `Undone — ${name} is waiting for approval again`) : null;
        }
        return typeof d.transitionId === "string" ? () => void undoVia(url, { ...base, decision: "undo_pass", transitionId: d.transitionId }, `Undone — ${name} is back`) : null;
      },
    });

  if (passing) {
    return (
      <div className="flex flex-wrap items-end gap-2">
        <Field label={`Why pass on ${name}? (optional)`}>
          <Input compact value={note} onChange={(e) => setNote(e.target.value)} placeholder="Not a fit for this product" className="w-64" />
        </Field>
        <Button size="sm" variant="danger" pending={pending} disabled={readOnly} onClick={() => decide("pass")}>
          Pass on them
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPassing(false)}>
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="primary" icon={<Check size={13} />} pending={pending} disabled={readOnly} onClick={() => decide("approve")}>
        {who === "agency" ? "Approve for them" : "Approve"}
      </Button>
      <Button size="sm" icon={<X size={13} />} disabled={readOnly} onClick={() => setPassing(true)}>
        Pass
      </Button>
    </div>
  );
}
