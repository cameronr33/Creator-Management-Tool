"use client";

import { useRef, useState } from "react";
import { Download, ExternalLink, PackageCheck, Printer, Truck } from "lucide-react";
import { Avatar, Badge, Button, Callout, Field, Input, StagePill } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import { compactNumber } from "@/lib/format";
import { PORTAL_EST_VIEWS_NOTE, PORTAL_VERIFIED_VIEWS_NOTE } from "@/lib/copy";
import type { PortalCreator, ViewsKind } from "@/lib/portal-data";

/** Who a creator is, the way the client sees them. */
export function PortalCreatorHeader({ c, showStage = true }: { c: PortalCreator; showStage?: boolean }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <Avatar name={c.name} src={c.photoUrl} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-text">{c.name}</span>
          {c.handle && c.profileUrl && (
            <a href={c.profileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs text-text-muted hover:text-accent">
              @{c.handle} <ExternalLink size={11} />
            </a>
          )}
          <Badge tone="info" title="Campaign">{c.campaignName}</Badge>
          {showStage && <StagePill stage={c.stage} />}
        </div>
        <p className="mt-0.5 text-xs text-text-muted">
          {c.followers != null ? `${compactNumber(c.followers)} followers` : "Followers not known yet"}
          {c.contentType ? ` · ${c.contentType}` : ""}
        </p>
      </div>
    </div>
  );
}

/**
 * The brand marks the product shipped (with tracking) or delivered. Marking
 * it shipped without a tracking number asks once first — without it nobody
 * can follow the parcel.
 */
export function PortalShipForm({ c, readOnly }: { c: PortalCreator; readOnly: boolean }) {
  const { pending, run } = useSave();
  const [carrier, setCarrier] = useState(c.shipment?.carrier ?? "");
  const [tracking, setTracking] = useState(c.shipment?.trackingNumber ?? "");
  const [askTracking, setAskTracking] = useState(false);
  const trackingInput = useRef<HTMLInputElement>(null);
  if (c.stage === "shipped") {
    return (
      <div className="print:hidden">
        <Button
          size="sm"
          variant="primary"
          icon={<PackageCheck size={13} />}
          pending={pending}
          disabled={readOnly}
          onClick={() => run(() => api("/api/client/ship", { partnershipId: c.partnershipId, status: "delivered" }), { success: `${c.name}: delivered` })}
        >
          It arrived — mark delivered
        </Button>
      </div>
    );
  }
  const markShipped = () =>
    run(
      () =>
        api("/api/client/ship", {
          partnershipId: c.partnershipId,
          status: "shipped",
          carrier: carrier.trim() || undefined,
          trackingNumber: tracking.trim() || undefined,
        }),
      { success: `${c.name}: shipped` },
    );
  return (
    <div className="space-y-2 print:hidden">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Carrier">
          <Input compact value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="UPS" className="w-28" />
        </Field>
        <Field label="Tracking number">
          <Input ref={trackingInput} compact value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="1Z…" className="w-48" />
        </Field>
        <Button
          size="sm"
          variant="primary"
          icon={<Truck size={13} />}
          pending={pending}
          disabled={readOnly}
          onClick={() => (tracking.trim() ? markShipped() : setAskTracking(true))}
        >
          Mark shipped
        </Button>
      </div>
      {askTracking && !tracking.trim() && (
        <Callout
          tone="warn"
          title="No tracking number?"
          actions={
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setAskTracking(false);
                  trackingInput.current?.focus();
                }}
              >
                Add it
              </Button>
              <Button size="sm" variant="ghost" pending={pending} disabled={readOnly} onClick={markShipped}>
                Mark shipped without it
              </Button>
            </>
          }
        >
          Neither the creator nor we can follow the parcel without it.
        </Callout>
      )}
    </div>
  );
}

/**
 * The shipping list, for a spreadsheet or on paper. The CSV is built on the
 * server from what this page already shows (portal-export.ts); the browser
 * only saves it.
 */
export function ShipListActions({ csv, fileStem }: { csv: string; fileStem: string }) {
  const download = () => {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileStem}-${day}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button size="sm" icon={<Download size={13} />} onClick={download} title="Every creator ready to ship, with their address and product — opens in Excel or Google Sheets">
        Download list (CSV)
      </Button>
      <Button size="sm" variant="ghost" icon={<Printer size={13} />} onClick={() => window.print()}>
        Print
      </Button>
    </div>
  );
}

/** A video's views, always saying which kind they are. */
export function VideoViews({ views, kind }: { views: number | null; kind: ViewsKind | null }) {
  if (views == null || !kind) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="tabular">{compactNumber(views)} views</span>
      <Badge tone={kind === "verified" ? "good" : "muted"} title={kind === "verified" ? PORTAL_VERIFIED_VIEWS_NOTE : PORTAL_EST_VIEWS_NOTE}>
        {kind}
      </Badge>
    </span>
  );
}
