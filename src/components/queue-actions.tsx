"use client";

import { useState } from "react";
import { Send, Truck, ClipboardPaste } from "lucide-react";
import { parseAddress } from "@/lib/address";
import { AddDeliverable } from "@/components/partnership-actions";
import { Button, Textarea, Callout } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import type { StallItem } from "@/lib/dashboard";

export type QueueKind = "follow_ups" | "awaiting_address" | "ready_to_ship" | "delivered_no_video";

/**
 * The inline action for one dashboard stall-queue row — each queue's most
 * common next step, without a round-trip through the detail page.
 */
export function QueueItemAction({ queue, item }: { queue: QueueKind; item: StallItem }) {
  switch (queue) {
    case "follow_ups":
      return (
        <Button size="sm" href={`/outreach#p-${item.partnershipId}`} icon={<Send size={12} />}>
          Go to outreach
        </Button>
      );
    case "awaiting_address":
      return <PasteAddressAction partnershipId={item.partnershipId} name={item.name} />;
    case "ready_to_ship":
      return item.shipmentId ? (
        <MarkShippedAction partnershipId={item.partnershipId} shipmentId={item.shipmentId} name={item.name} />
      ) : null;
    case "delivered_no_video":
      return <AddDeliverable partnershipId={item.partnershipId} />;
  }
}

function MarkShippedAction({
  partnershipId,
  shipmentId,
  name,
}: {
  partnershipId: string;
  shipmentId: string;
  name: string;
}) {
  const { pending, run } = useSave();
  return (
    <Button
      size="sm"
      icon={<Truck size={12} />}
      pending={pending}
      onClick={() =>
        run(() => api("/api/shipments", { id: shipmentId, partnershipId, status: "shipped" }), {
          success: `${name} marked shipped`,
        })
      }
    >
      Mark shipped
    </Button>
  );
}

function PasteAddressAction({ partnershipId, name }: { partnershipId: string; name: string }) {
  const { pending, run } = useSave();
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [issues, setIssues] = useState<string[]>([]);

  const parseAndSave = async () => {
    const parsed = parseAddress(paste);
    if (!parsed || !parsed.isComplete) {
      setIssues(
        parsed?.issues.length
          ? parsed.issues.map((i) => `Couldn't find the ${i.replace(/^no /, "")}`)
          : ["Couldn't read that — open the record to enter it by hand."],
      );
      return;
    }
    // A complete address auto-advances awaiting_address → fulfilling
    // server-side, which also drops the row out of this queue.
    const r = await run(
      () =>
        api(
          `/api/partnerships/${partnershipId}`,
          {
            recipientName: parsed.recipientName,
            addressLine1: parsed.addressLine1,
            addressLine2: parsed.addressLine2,
            city: parsed.city,
            region: parsed.region,
            postalCode: parsed.postalCode,
            country: parsed.country,
            addressRaw: parsed.raw,
          },
          "PATCH",
        ),
      { success: `Address saved for ${name}` },
    );
    if (r.ok) setOpen(false);
  };

  if (!open) {
    return (
      <Button size="sm" icon={<ClipboardPaste size={12} />} onClick={() => setOpen(true)}>
        Paste address
      </Button>
    );
  }

  return (
    <div className="w-full space-y-1.5">
      <Textarea
        compact
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        placeholder={"Paste the address exactly as they sent it — one line or several:\nJoe Hubbard\n3333 Simeon Bunker St\nSaint Charles, MO 63301"}
        rows={4}
        autoFocus
        aria-label="Shipping address"
      />
      {issues.length > 0 && <Callout tone="warn">{issues.join(". ")}.</Callout>}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={parseAndSave} pending={pending} disabled={!paste.trim()}>
          Save address
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
