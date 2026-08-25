import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ExternalLink,
  Mail,
  ArrowLeft,
  Eye,
  Play,
  MapPin,
  Package,
  FileText,
  Clapperboard,
} from "lucide-react";
import { getPartnershipDetail, resolveClient, getDefaultTemplate } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { Card, StagePill, Avatar, Badge, SectionTitle } from "@/components/ui";
import {
  StageSelect,
  OutreachComposer,
  ShipmentControls,
  AddDeliverable,
  FeeEditor,
  AgreementEditor,
  BriefEditor,
} from "@/components/partnership-actions";
import {
  EditableProfile,
  SocialsEditor,
  AddressEditor,
  ProductEditor,
} from "@/components/profile-editors";
import { FullAnalysisButton } from "@/components/full-analysis-button";
import { getLatestRequestForPartnership } from "@/lib/research-requests";
import { compactNumber, fullNumber, money, shortDate, relativeDays } from "@/lib/format";
import { renderTemplate, firstName } from "@/lib/outreach";
import { formatAddress } from "@/lib/address";
import { isTerminal } from "@/lib/stages";

export default async function CreatorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [detail, latestRequest] = await Promise.all([
    getPartnershipDetail(id),
    getLatestRequestForPartnership(id),
  ]);
  if (!detail) notFound();

  const { creator, partnership, campaign, reels, socials, events, products, shipments, deliverables, outreach, otherPartnerships } = detail;
  const shipment = shipments[0] ?? null;

  const client = await resolveClient(await getSelectedClientSlug());
  const template = client ? await getDefaultTemplate(client.id) : null;
  const suggested = template
    ? renderTemplate(template.body, {
        name: firstName(creator.name),
        content_descriptor: creator.contentPillar ?? "content",
        reason: partnership.outreachReason ?? "",
      })
    : null;

  const metrics = [
    { label: "Followers", value: fullNumber(creator.followers) },
    { label: "Avg views", value: fullNumber(creator.avgViews) },
    { label: "Median views", value: fullNumber(creator.medianViews) },
    { label: "Max views", value: fullNumber(creator.maxViews) },
    { label: "Cadence", value: creator.cadencePerWeek ? `${Number(creator.cadencePerWeek).toFixed(1)}/wk` : "—" },
    { label: "Reels pulled", value: creator.reelsPulled ?? "—" },
  ];

  return (
    <div>
      {/* Header */}
      <div className="border-b border-border bg-surface px-6 py-4">
        <Link href="/creators" className="mb-3 inline-flex items-center gap-1 text-sm text-text-muted hover:text-accent">
          <ArrowLeft size={14} /> Creators
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Avatar name={creator.name} />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold text-text">{creator.name}</h1>
                {creator.viewsSource === "apify" && (
                  <span title="View metrics are Apify estimates, not public Views">
                    <Badge tone="muted">est. views</Badge>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <a href={creator.profileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-accent">
                  @{creator.username} <ExternalLink size={12} />
                </a>
                {creator.businessEmail && (
                  <a href={`mailto:${creator.businessEmail}`} className="inline-flex items-center gap-0.5 hover:text-accent">
                    <Mail size={12} /> {creator.businessEmail}
                  </a>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted">{campaign.name}</span>
            <StagePill stage={partnership.stage} />
            <StageSelect partnershipId={partnership.id} stage={partnership.stage} />
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {creator.contentPillar && <Badge tone="accent">{creator.contentPillar}</Badge>}
          <SocialsEditor creatorId={creator.id} socials={socials} />
          <EditableProfile creator={creator} />
        </div>
        {otherPartnerships.length > 0 && (
          <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
            <span>Also in:</span>
            {otherPartnerships.map((p) => (
              <Link key={p.id} href={`/creators/${p.id}`} className="rounded-md bg-surface-2 px-2 py-0.5 hover:text-accent">
                {p.campaignName}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-3">
        {/* Left: research */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>Research</SectionTitle>
              <FullAnalysisButton partnershipId={partnership.id} initialRequest={latestRequest} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {metrics.map((m) => (
                <div key={m.label}>
                  <div className="text-xs text-text-faint">{m.label}</div>
                  <div className="tabular text-base font-semibold text-text">{m.value}</div>
                </div>
              ))}
            </div>
            {creator.dateRangeStart && (
              <div className="mt-2 text-xs text-text-faint">
                Sampled {shortDate(creator.dateRangeStart)} – {shortDate(creator.dateRangeEnd)} ·{" "}
                {creator.viewsSource === "ig_public_chrome" ? "Public IG views" : creator.viewsSource === "apify" ? "Apify estimate" : "unknown source"}
              </div>
            )}
            {creator.contentTypeSummary && (
              <p className="mt-3 border-t border-border pt-3 text-sm leading-relaxed text-text-muted">
                {creator.contentTypeSummary}
              </p>
            )}
          </Card>

          {reels.length > 0 && (
            <Card className="p-4">
              <SectionTitle>Top reels</SectionTitle>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {reels.map((reel) => (
                  <a
                    key={reel.id}
                    href={reel.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group rounded-lg border border-border p-3 transition hover:border-accent hover:bg-surface-2"
                  >
                    <div className="flex items-center justify-between text-xs text-text-faint">
                      <span className="flex items-center gap-1"><Play size={11} /> #{reel.rank}</span>
                      <span className="flex items-center gap-1 tabular font-semibold text-text">
                        <Eye size={11} /> {compactNumber(reel.views)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-4 text-xs text-text-muted">{reel.description ?? "No description"}</p>
                  </a>
                ))}
              </div>
            </Card>
          )}

          {/* Outreach timeline */}
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <SectionTitle>Outreach</SectionTitle>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                {outreach.hasReplied ? (
                  <Badge tone="good">replied</Badge>
                ) : outreach.totalOutbound > 0 ? (
                  <Badge tone="warn">{outreach.followUpCount} follow-up{outreach.followUpCount === 1 ? "" : "s"}</Badge>
                ) : (
                  <Badge tone="muted">not contacted</Badge>
                )}
              </div>
            </div>

            <div className="mt-3">
              <OutreachComposer partnershipId={partnership.id} suggestedMessage={suggested} />
            </div>

            {events.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-border pt-4">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-3 text-sm">
                    <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.direction === "inbound" ? "bg-emerald-500" : "bg-accent"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text">
                          {e.direction === "inbound" ? "They replied" : e.kind === "initial" ? "Initial outreach" : e.kind === "follow_up" ? "Follow-up" : "Note"}
                        </span>
                        <span className="text-xs text-text-faint">
                          {e.isMigrated ? "date unknown (migrated)" : relativeDays(e.occurredAt)} · {e.channel.replace("_", " ")}
                        </span>
                      </div>
                      {e.body && e.body !== "migrated from sheet; original date unknown" && (
                        <p className="text-text-muted">{e.body}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Right: deal / fulfilment */}
        <div className="space-y-6">
          <Card className="p-4">
            <SectionTitle>Agreement</SectionTitle>
            <div className="mt-3 space-y-3">
              <AgreementEditor
                partnershipId={partnership.id}
                agreementType={partnership.agreementType}
                agreedTerms={partnership.agreedTerms}
                exitReason={partnership.exitReason}
                notes={partnership.notes}
                isTerminal={isTerminal(partnership.stage)}
              />
              <div className="border-t border-border pt-3">
                <div className="mb-1 text-sm text-text-muted">Compensation</div>
                <FeeEditor
                  partnershipId={partnership.id}
                  feeAmount={partnership.feeAmount}
                  compensationType={partnership.compensationType}
                />
                {partnership.feeAmount && partnership.compensationType !== "free_product" && (
                  <div className="mt-1 text-xs text-text-faint">Recorded {money(partnership.feeAmount)} — payment tracked in accounting</div>
                )}
              </div>
            </div>
          </Card>

          {/* Products */}
          <Card className="p-4">
            <div className="flex items-center gap-1.5">
              <Package size={14} className="text-text-faint" />
              <SectionTitle>Product</SectionTitle>
            </div>
            <div className="mt-3">
              <ProductEditor partnershipId={partnership.id} products={products} />
            </div>
          </Card>

          {/* Shipping */}
          <Card className="p-4">
            <div className="flex items-center gap-1.5">
              <MapPin size={14} className="text-text-faint" />
              <SectionTitle>Shipping</SectionTitle>
            </div>
            {partnership.addressLine1 || partnership.city || partnership.addressRaw ? (
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-text-muted">
                {formatAddress(partnership) || partnership.addressRaw}
              </pre>
            ) : (
              <p className="mt-2 text-sm text-amber-700">No address on file</p>
            )}
            <div className="mt-2">
              <AddressEditor partnership={partnership} />
            </div>
            <div className="mt-3 border-t border-border pt-3">
              <ShipmentControls partnershipId={partnership.id} shipment={shipment} />
              {shipment?.shippedAt && (
                <div className="mt-2 text-xs text-text-faint">Shipped {shortDate(shipment.shippedAt)}</div>
              )}
            </div>
          </Card>

          {/* Brief + Deliverables */}
          <Card className="p-4">
            <div className="flex items-center gap-1.5">
              <Clapperboard size={14} className="text-text-faint" />
              <SectionTitle>Content</SectionTitle>
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <FileText size={14} className="shrink-0 text-text-faint" />
              <div className="min-w-0 flex-1">
                <BriefEditor
                  partnershipId={partnership.id}
                  briefUrl={partnership.briefUrl}
                  briefSentAt={partnership.briefSentAt ? shortDate(partnership.briefSentAt) : null}
                />
              </div>
            </div>
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              {deliverables.length === 0 ? (
                <p className="text-sm text-text-faint">No videos posted yet</p>
              ) : (
                deliverables.map((d) => (
                  <a
                    key={d.id}
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-lg border border-border p-2 text-sm transition hover:border-accent"
                  >
                    <span className="truncate text-text">{d.postedAt ? shortDate(d.postedAt) : "posted"}</span>
                    <span className="flex items-center gap-1 tabular text-text-muted">
                      <Eye size={12} /> {compactNumber(d.views)}
                      {d.metricsSource === "apify" && <Badge tone="muted">est</Badge>}
                    </span>
                  </a>
                ))
              )}
              <AddDeliverable partnershipId={partnership.id} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
