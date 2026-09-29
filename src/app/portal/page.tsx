import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Check, Clapperboard, Truck } from "lucide-react";
import { AToZStrip } from "@/components/a-to-z";
import { Card, CardHeader, Callout, StatTile } from "@/components/ui";
import { VideoViews } from "@/components/portal";
import { getPortalContext, getPortalCreators } from "@/lib/portal-data";
import { portalViewTotals } from "@/lib/portal-export";
import { PORTAL_EST_VIEWS_NOTE, PORTAL_VERIFIED_VIEWS_NOTE } from "@/lib/copy";
import { compactNumber } from "@/lib/format";
import { isTerminal } from "@/lib/stages";
import type { CmStage } from "@/lib/db/schema";

/** Where things stand for this brand, and what's waiting on them. */
export default async function PortalOverview() {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/login");
  const creators = await getPortalCreators(ctx.clientId);
  const live = creators.filter((c) => !isTerminal(c.stage));
  const counts: Partial<Record<CmStage, number>> = {};
  for (const c of live) counts[c.stage] = (counts[c.stage] ?? 0) + 1;
  const toApprove = live.filter((c) => c.clientApproval === "pending" && c.stage === "shortlisted").length;
  const toShip = live.filter((c) => c.stage === "fulfilling").length;
  const videos = creators.reduce((n, c) => n + c.videos.length, 0);
  const campaigns = [...new Set(creators.map((c) => c.campaignName))];
  const views = portalViewTotals(creators);

  return (
    <>
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-text">{ctx.readOnly ? `${ctx.clientName}'s creator program` : ctx.viewerName ? `Hi ${ctx.viewerName.split(" ")[0]}` : "Your creator program"}</h1>
        <p className="text-sm text-text-muted">
          {live.length} creator{live.length === 1 ? "" : "s"} in progress{campaigns.length ? ` across ${campaigns.join(", ")}` : ""}.
        </p>
      </div>
      {toApprove > 0 && (
        <Callout tone="warn" icon={<Check size={16} />} title={`${toApprove} creator${toApprove === 1 ? " is" : "s are"} waiting for your approval`} actions={<Link href="/portal/approve" className="inline-flex items-center gap-1 text-sm font-medium underline">Review them <ArrowRight size={13} /></Link>}>
          We won&apos;t reach out to them until you approve.
        </Callout>
      )}
      {toShip > 0 && (
        <Callout tone="info" icon={<Truck size={16} />} title={`${toShip} creator${toShip === 1 ? " is" : "s are"} ready for product`} actions={<Link href="/portal/ship" className="inline-flex items-center gap-1 text-sm font-medium underline">See addresses <ArrowRight size={13} /></Link>}>
          They&apos;ve agreed and their address is confirmed. Mark each one shipped with the tracking number.
        </Callout>
      )}
      <AToZStrip counts={counts} links={false} />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="In progress" value={String(live.length)} />
        <StatTile label="Product on its way" value={String(counts.shipped ?? 0)} />
        <StatTile label="Videos posted" value={String(videos)} />
      </div>
      {(views.verifiedVideos > 0 || views.estimatedVideos > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile
            label="Verified views"
            value={views.verifiedVideos ? compactNumber(views.verified) : "—"}
            sub={`${views.verifiedVideos} video${views.verifiedVideos === 1 ? "" : "s"} · read from Instagram's public count`}
            title={PORTAL_VERIFIED_VIEWS_NOTE}
          />
          <StatTile
            label="Estimated views · not added to verified"
            value={views.estimatedVideos ? compactNumber(views.estimated) : "—"}
            sub={`${views.estimatedVideos} video${views.estimatedVideos === 1 ? "" : "s"} · an automated count that usually runs low`}
            title={PORTAL_EST_VIEWS_NOTE}
          />
        </div>
      )}
      {videos > 0 && (
        <Card className="p-4">
          <CardHeader title="Latest videos" icon={<Clapperboard size={14} />} />
          <ul className="mt-3 space-y-1.5 text-sm">
            {creators
              .flatMap((c) => c.videos.map((v) => ({ ...v, name: c.name })))
              .sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))
              .slice(0, 8)
              .map((v) => (
                <li key={v.url} className="flex flex-wrap items-center gap-x-1.5">
                  <a href={v.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    {v.name}
                  </a>
                  {v.postedAt && <span className="text-text-faint">· {new Date(v.postedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                  <span className="text-xs text-text-muted">
                    <VideoViews views={v.views} kind={v.viewsKind} />
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      )}
    </>
  );
}
