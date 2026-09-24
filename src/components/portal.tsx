"use client";

import { useState } from "react";
import { ExternalLink, PackageCheck, Truck } from "lucide-react";
import { Avatar, Badge, Button, Field, Input, StagePill } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import { compactNumber } from "@/lib/format";
import type { PortalCreator } from "@/lib/portal-data";

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

/** The brand marks the product shipped (with tracking) or delivered. */
export function PortalShipForm({ c, readOnly }: { c: PortalCreator; readOnly: boolean }) {
  const { pending, run } = useSave();
  const [carrier, setCarrier] = useState(c.shipment?.carrier ?? "");
  const [tracking, setTracking] = useState(c.shipment?.trackingNumber ?? "");
  if (c.stage === "shipped") {
    return (
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
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Carrier">
        <Input compact value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="UPS" className="w-28" />
      </Field>
      <Field label="Tracking number">
        <Input compact value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="1Z…" className="w-48" />
      </Field>
      <Button
        size="sm"
        variant="primary"
        icon={<Truck size={13} />}
        pending={pending}
        disabled={readOnly}
        onClick={() =>
          run(
            () =>
              api("/api/client/ship", {
                partnershipId: c.partnershipId,
                status: "shipped",
                carrier: carrier.trim() || undefined,
                trackingNumber: tracking.trim() || undefined,
              }),
            { success: `${c.name}: shipped` },
          )
        }
      >
        Mark shipped
      </Button>
    </div>
  );
}
