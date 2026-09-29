import { TrackingLink } from "@/components/tracking-link";
import { redirect } from "next/navigation";
import { MapPin, Package } from "lucide-react";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { PortalCreatorHeader, PortalShipForm, ShipListActions } from "@/components/portal";
import { getPortalContext, getPortalCreators } from "@/lib/portal-data";
import { shippingListCsv } from "@/lib/portal-export";
import { shortDate } from "@/lib/format";

/** Product to send, with the confirmed address; then what's on its way. */
export default async function PortalShip() {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/login");
  const creators = await getPortalCreators(ctx.clientId);
  const ready = creators.filter((c) => c.stage === "fulfilling");
  const onTheWay = creators.filter((c) => c.stage === "shipped");
  const fileStem = `${ctx.clientName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "creators"}-shipping-list`;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-text">
            Ship product<span className="hidden print:inline"> · {ctx.clientName}</span>
          </h1>
          <p className="text-sm text-text-muted print:hidden">These creators have agreed and confirmed their address. Mark each one shipped with the tracking number — we&apos;ll take it from there.</p>
        </div>
        {ready.length > 0 && <ShipListActions csv={shippingListCsv(ready)} fileStem={fileStem} />}
      </div>
      {ready.length === 0 ? (
        <EmptyState title="Nothing to ship right now" hint="Creators appear here once they've agreed and their address is confirmed." />
      ) : (
        <Card className="overflow-hidden">
          <CardHeader title={`Ready to ship (${ready.length})`} icon={<Package size={14} />} />
          <ul className="divide-y divide-border">
            {ready.map((c) => (
              <li key={c.partnershipId} className="space-y-3 px-4 py-3">
                <PortalCreatorHeader c={c} showStage={false} />
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <div className="flex items-center gap-1 text-xs font-medium text-text-muted">
                      <MapPin size={12} /> Ship to
                    </div>
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-text">{c.shipTo ?? "Address not confirmed yet"}</pre>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-text-muted">Product</div>
                    <p className="mt-1 text-text">{c.products.length ? c.products.join(", ") : "Not specified — check with us"}</p>
                  </div>
                </div>
                <PortalShipForm c={c} readOnly={ctx.readOnly} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {onTheWay.length > 0 && (
        <Card className="overflow-hidden print:hidden">
          <CardHeader title={`On the way (${onTheWay.length})`} description="Mark it delivered when it arrives, if we haven't already." />
          <ul className="divide-y divide-border">
            {onTheWay.map((c) => (
              <li key={c.partnershipId} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <PortalCreatorHeader c={c} showStage={false} />
                  <p className="ml-11 mt-1 text-xs text-text-muted">
                    Shipped{c.shipment?.shippedAt ? ` ${shortDate(c.shipment.shippedAt)}` : ""}
                    {c.shipment?.trackingNumber ? (
                      <>
                        {" · "}
                        <TrackingLink carrier={c.shipment.carrier} number={c.shipment.trackingNumber} />
                      </>
                    ) : c.shipment?.carrier ? (
                      ` · ${c.shipment.carrier}`
                    ) : (
                      ""
                    )}
                  </p>
                </div>
                <PortalShipForm c={c} readOnly={ctx.readOnly} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
