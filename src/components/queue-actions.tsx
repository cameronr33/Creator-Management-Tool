"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send, Truck, ClipboardPaste } from "lucide-react";
import { parseAddress } from "@/lib/address";
import { AddDeliverable } from "@/components/partnership-actions";
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
        <Link
          href="/outreach"
          className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-text-muted transition hover:bg-surface-2"
          onClick={(e) => e.stopPropagation()}
        >
          <Send size={12} /> Compose
        </Link>
      );
    case "awaiting_address":
      return <PasteAddressAction partnershipId={item.partnershipId} />;
    case "ready_to_ship":
      return item.shipmentId ? (
        <MarkShippedAction partnershipId={item.partnershipId} shipmentId={item.shipmentId} />
      ) : null;
    case "delivered_no_video":
      return (
        <span onClick={(e) => e.stopPropagation()}>
          <AddDeliverable partnershipId={item.partnershipId} />
        </span>
      );
  }
}

function MarkShippedAction({ partnershipId, shipmentId }: { partnershipId: string; shipmentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const markShipped = async () => {
    setPending(true);
    const res = await fetch("/api/shipments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: shipmentId, partnershipId, status: "shipped" }),
    });
    setPending(false);
    if (res.ok) router.refresh();
  };

  return (
    <button
      onClick={markShipped}
      disabled={pending}
      className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-text-muted transition hover:bg-surface-2 disabled:opacity-50"
    >
      <Truck size={12} /> {pending ? "…" : "Mark shipped"}
    </button>
  );
}

function PasteAddressAction({ partnershipId }: { partnershipId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  const parseAndSave = async () => {
    const parsed = parseAddress(paste);
    if (!parsed || !parsed.isComplete) {
      setIssues(
        parsed?.issues.length
          ? parsed.issues
          : ["Could not parse — open the creator to enter it manually."],
      );
      return;
    }
    setPending(true);
    const res = await fetch(`/api/partnerships/${partnershipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientName: parsed.recipientName,
        addressLine1: parsed.addressLine1,
        addressLine2: parsed.addressLine2,
        city: parsed.city,
        region: parsed.region,
        postalCode: parsed.postalCode,
        country: parsed.country,
        addressRaw: parsed.raw,
      }),
    });
    setPending(false);
    // A complete address auto-advances awaiting_address → fulfilling
    // server-side, which also drops the row out of this queue.
    if (res.ok) router.refresh();
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-text-muted transition hover:bg-surface-2"
      >
        <ClipboardPaste size={12} /> Paste address
      </button>
    );
  }

  return (
    <div className="w-full space-y-1" onClick={(e) => e.stopPropagation()}>
      <div className="flex gap-1">
        <input
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="Paste address from the DM…"
          autoFocus
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
        />
        <button
          onClick={parseAndSave}
          disabled={pending || !paste.trim()}
          className="shrink-0 rounded-lg bg-accent px-2 py-1 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          Save
        </button>
      </div>
      {issues.map((iss) => (
        <p key={iss} className="text-xs text-amber-700">⚠ {iss}</p>
      ))}
    </div>
  );
}
