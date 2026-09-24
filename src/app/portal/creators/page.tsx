import { redirect } from "next/navigation";
import { Badge, Card, EmptyState } from "@/components/ui";
import { PortalCreatorHeader } from "@/components/portal";
import { getPortalContext, getPortalCreators } from "@/lib/portal-data";
import { shortDate } from "@/lib/format";
import { isTerminal } from "@/lib/stages";

/** Every creator in the program: where they are, shipping, and their videos. */
export default async function PortalCreators() {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/login");
  const creators = await getPortalCreators(ctx.clientId);
  const live = creators.filter((c) => !isTerminal(c.stage));
  const closed = creators.filter((c) => isTerminal(c.stage));
  const list = (items: typeof creators) => (
    <ul className="divide-y divide-border">
      {items.map((c) => (
        <li key={c.partnershipId} className="space-y-1.5 px-4 py-3">
          <PortalCreatorHeader c={c} />
          <div className="ml-11 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            {c.clientApproval === "pending" && c.stage === "shortlisted" && <Badge tone="warn">Waiting for your approval</Badge>}
            {c.shipment?.status === "shipped" && <span>Shipped{c.shipment.shippedAt ? ` ${shortDate(c.shipment.shippedAt)}` : ""}{c.shipment.trackingNumber ? ` · ${c.shipment.trackingNumber}` : ""}</span>}
            {c.shipment?.status === "delivered" && <span>Delivered{c.shipment.deliveredAt ? ` ${shortDate(c.shipment.deliveredAt)}` : ""}</span>}
            {c.videos.map((v, i) => (
              <a key={v.url} href={v.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                Video {c.videos.length > 1 ? i + 1 : ""}
                {v.postedAt ? ` · ${shortDate(v.postedAt)}` : ""}
              </a>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-text">All creators</h1>
        <p className="text-sm text-text-muted">Everyone in your program and where they are.</p>
      </div>
      {live.length === 0 ? <EmptyState title="No creators in progress yet" /> : <Card className="overflow-hidden">{list(live)}</Card>}
      {closed.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-text-muted hover:text-accent">Not going ahead ({closed.length})</summary>
          <Card className="mt-2 overflow-hidden">{list(closed)}</Card>
        </details>
      )}
    </>
  );
}
