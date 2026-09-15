import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ExternalLink,
  Mail,
  ArrowLeft,
  ArrowRight,
  Eye,
  Play,
  MapPin,
  Package,
  Clapperboard,
  MessageSquare,
  Handshake,
  FlaskConical,
} from "lucide-react";
import { getPartnershipDetail, resolveClient, getDefaultTemplates } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { getActiveGmailAccount } from "@/lib/gmail-sync";
import { Card, CardHeader, StagePill, Avatar, Badge, Callout } from "@/components/ui";
import {
  StageControl,
  TimelineNote,
  ShipmentControls,
  AddDeliverable,
  FeeEditor,
  AgreementEditor,
  BriefEditor,
  Disclosure,
} from "@/components/partnership-actions";
import {
  EditableProfile,
  SocialsEditor,
  EmailsEditor,
  AddressEditor,
  ProductEditor,
} from "@/components/profile-editors";
import { MessageComposer } from "@/components/message-composer";
import { ReplyButton } from "@/components/reply-button";
import { FullAnalysisButton } from "@/components/full-analysis-button";
import { getLatestRequestForPartnership } from "@/lib/research-requests";
import { getCreatorEmails } from "@/lib/email-suggestions";
import { compactNumber, fullNumber, money, shortDate, relativeDays } from "@/lib/format";
import { channelLabel } from "@/lib/outreach";
import { formatAddress } from "@/lib/address";
import { displayNames } from "@/lib/email-body";
import { AUTO_STAGE_RULES, type AutoStageTrigger } from "@/lib/auto-stage";
import { AUTO_TRIGGER_LABELS, stageLabel, stageIndex } from "@/lib/stages";
import { nextStep } from "@/lib/next-step";
import { EST_VIEWS_NOTE, VERIFIED_VIEWS_NOTE } from "@/lib/copy";

const TIMELINE_PREVIEW = 5;

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

  const { creator, partnership, campaign, reels, socials, events, products, shipments, deliverables, outreach, otherPartnerships } =
    detail;
  const shipment = shipments[0] ?? null;

  const [client, creatorEmails, gmailAccount] = await Promise.all([
    resolveClient(await getSelectedClientSlug()),
    getCreatorEmails(creator.id),
    getActiveGmailAccount(),
  ]);
  const templates = client ? await getDefaultTemplates(client.id) : { ig_dm: null, email: null };

  const hasAddress = !!(partnership.addressLine1 && partnership.city && partnership.region && partnership.postalCode);
  const step = nextStep({
    stage: partnership.stage,
    hasAddress,
    shipmentStatus: shipment?.status ?? null,
    hasBrief: !!partnership.briefUrl,
    briefSent: !!partnership.briefSentAt,
    deliverables: deliverables.length,
    hasReplied: outreach.hasReplied,
    totalOutbound: outreach.totalOutbound,
    followUpCount: outreach.followUpCount,
    daysSinceLastOutbound: outreach.daysSinceLastOutbound,
    datesAreMigrated: outreach.datesAreMigrated,
    exitReason: partnership.exitReason,
  });

  // What the auto-stage engine would do from here, in plain words.
  const autoMoves = (Object.keys(AUTO_STAGE_RULES) as AutoStageTrigger[])
    .filter((t) => AUTO_STAGE_RULES[t].from.includes(partnership.stage))
    .map((t) => `moves to ${stageLabel(AUTO_STAGE_RULES[t].to)} when ${AUTO_TRIGGER_LABELS[t]}`);
  const autoNote = autoMoves.length ? `By itself: ${autoMoves.join("; ")}.` : null;

  const metrics = [
    { label: "Followers", value: fullNumber(creator.followers) },
    { label: "Avg views", value: fullNumber(creator.avgViews) },
    { label: "Median views", value: fullNumber(creator.medianViews) },
    { label: "Max views", value: fullNumber(creator.maxViews) },
    { label: "Posts / week", value: creator.cadencePerWeek ? Number(creator.cadencePerWeek).toFixed(1) : "—" },
    { label: "Reels sampled", value: creator.reelsPulled ?? "—" },
  ];

  const conversationBadge = outreach.hasReplied ? (
    <Badge tone="good">replied</Badge>
  ) : outreach.totalOutbound > 0 ? (
    <Badge tone="warn">
      {outreach.followUpCount} follow-up{outreach.followUpCount === 1 ? "" : "s"} · no reply
    </Badge>
  ) : (
    <Badge tone="muted">not contacted</Badge>
  );

  const composerKind = outreach.totalOutbound === 0 ? "initial" : "follow_up";
  const composerOpen = stageIndex(partnership.stage) >= 0 && stageIndex(partnership.stage) <= stageIndex("contacted");
  const visibleEvents = events.slice(0, TIMELINE_PREVIEW);
  const hiddenEvents = events.slice(TIMELINE_PREVIEW);
  const addressAlarm = !hasAddress && stageIndex(partnership.stage) >= stageIndex("awaiting_address");

  return (
    <div>
      {/* Header */}
      <div className="border-b border-border bg-surface px-6 py-4">
        <Link href="/creators" className="mb-3 inline-flex items-center gap-1 text-sm text-text-muted hover:text-accent">
          <ArrowLeft size={14} /> Creators
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar name={creator.name} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight text-text">{creator.name}</h1>
                <StagePill stage={partnership.stage} />
                {creator.contentPillar && <Badge tone="accent">{creator.contentPillar}</Badge>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
                <a href={creator.profileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-accent">
                  @{creator.username} <ExternalLink size={12} />
                </a>
                {creator.businessEmail && (
                  <a href={`mailto:${creator.businessEmail}`} className="inline-flex items-center gap-1 hover:text-accent">
                    <Mail size={12} /> {creator.businessEmail}
                  </a>
                )}
                <span>
                  {client?.name ? `${client.name} · ` : ""}
                  {campaign.name}
                </span>
                {otherPartnerships.length > 0 && (
                  <span className="flex items-center gap-1 text-xs">
                    Also on:
                    {otherPartnerships.map((p) => (
                      <Link key={p.id} href={`/creators/${p.id}`} className="rounded-md bg-surface-2 px-1.5 py-0.5 hover:text-accent">
                        {p.campaignName}
                      </Link>
                    ))}
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
                <ArrowRight size={15} className="mt-0.5 shrink-0" />
                <span>
                  <span className="font-semibold">Next:</span> {step.text}
                  {step.anchor && (
                    <>
                      {" "}
                      <a href={`#${step.anchor}`} className="font-medium underline">
                        Go
                      </a>
                    </>
                  )}
                </span>
              </div>
            </div>
          </div>
          <StageControl
            partnershipId={partnership.id}
            stage={partnership.stage}
            exitReason={partnership.exitReason}
            autoNote={autoNote}
          />
        </div>
        <div className="mt-3">
          <Disclosure label="Links, emails & profile">
            <div className="space-y-3">
              <SocialsEditor creatorId={creator.id} socials={socials} />
              <EmailsEditor creatorId={creator.id} emails={creatorEmails} />
              <EditableProfile creator={creator} />
            </div>
          </Disclosure>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-3">
        {/* Left: the conversation first, research after. */}
        <div className="space-y-6 lg:col-span-2">
          <Card id="conversation" className="scroll-mt-4 p-4">
            <CardHeader
              title="Conversation"
              icon={<MessageSquare size={14} />}
              description="Every message in or out. Emails arrive here by themselves when the shared mailbox is on cc."
              actions={
                <>
                  {conversationBadge}
                  <ReplyButton partnershipId={partnership.id} name={creator.name} />
                </>
              }
            />

            {events.length === 0 ? (
              <p className="mt-3 text-sm text-text-muted">Nothing logged yet.</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {visibleEvents.map((e) => (
                  <TimelineEvent key={e.id} e={e} />
                ))}
                {hiddenEvents.length > 0 && (
                  <li>
                    <details>
                      <summary className="cursor-pointer text-xs font-medium text-text-muted hover:text-accent">
                        Show {hiddenEvents.length} earlier
                      </summary>
                      <ul className="mt-2.5 space-y-2.5">
                        {hiddenEvents.map((e) => (
                          <TimelineEvent key={e.id} e={e} />
                        ))}
                      </ul>
                    </details>
                  </li>
                )}
              </ul>
            )}

            <div className="mt-4 space-y-3 border-t border-border pt-4">
              <Disclosure label={composerKind === "initial" ? "Write the first message" : "Write a follow-up"} defaultOpen={composerOpen}>
                <MessageComposer
                  target={{
                    partnershipId: partnership.id,
                    name: creator.name,
                    username: creator.username,
                    businessEmail: creator.businessEmail,
                    contentPillar: creator.contentPillar,
                    outreachReason: partnership.outreachReason,
                  }}
                  templates={{
                    ig_dm: templates.ig_dm ? { subject: null, body: templates.ig_dm.body } : null,
                    email: templates.email ? { subject: templates.email.subject, body: templates.email.body } : null,
                    ccEmail: gmailAccount?.email ?? null,
                  }}
                  kind={composerKind}
                />
              </Disclosure>
              <TimelineNote partnershipId={partnership.id} hasOutbound={outreach.totalOutbound > 0} />
            </div>
          </Card>

          <Card className="p-4">
            <CardHeader
              title="Research"
              icon={<FlaskConical size={14} />}
              actions={<FullAnalysisButton partnershipId={partnership.id} initialRequest={latestRequest} />}
            />
            <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {metrics.map((m) => (
                <div key={m.label}>
                  <div className="text-xs text-text-muted">{m.label}</div>
                  <div className="tabular text-base font-semibold text-text">{m.value}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
              {creator.dateRangeStart && (
                <span>
                  Sampled {shortDate(creator.dateRangeStart)} – {shortDate(creator.dateRangeEnd)}
                </span>
              )}
              {creator.viewsSource === "ig_public_chrome" ? (
                <Badge tone="good" title={VERIFIED_VIEWS_NOTE}>
                  verified views
                </Badge>
              ) : creator.viewsSource === "apify" ? (
                <Badge tone="muted" title={EST_VIEWS_NOTE}>
                  estimated views
                </Badge>
              ) : creator.avgViews != null ? (
                <Badge tone="muted">view source unknown</Badge>
              ) : null}
            </div>
            {creator.contentTypeSummary && (
              <p className="mt-3 border-t border-border pt-3 text-sm leading-relaxed text-text-muted">
                {creator.contentTypeSummary}
              </p>
            )}
          </Card>

          {reels.length > 0 && (
            <Card className="p-4">
              <CardHeader title="Top reels" />
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {reels.map((reel) => (
                  <a
                    key={reel.id}
                    href={reel.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-border p-3 transition hover:border-accent-ring hover:bg-surface-2"
                  >
                    <div className="flex items-center justify-between text-xs text-text-muted">
                      <span className="flex items-center gap-1">
                        <Play size={11} /> #{reel.rank}
                      </span>
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
        </div>

        {/* Right: deal → product → shipping → content, in pipeline order. */}
        <div className="space-y-6">
          <Card id="agreement" className="scroll-mt-4 p-4">
            <CardHeader title="Agreement" icon={<Handshake size={14} />} />
            <div className="mt-3 space-y-3">
              <AgreementEditor
                partnershipId={partnership.id}
                agreementType={partnership.agreementType}
                agreedTerms={partnership.agreedTerms}
                notes={partnership.notes}
              />
              <div className="border-t border-border pt-3">
                <FeeEditor
                  partnershipId={partnership.id}
                  feeAmount={partnership.feeAmount}
                  compensationType={partnership.compensationType}
                />
                {partnership.feeAmount && partnership.compensationType !== "free_product" && (
                  <div className="mt-1 text-xs text-text-faint">
                    {money(partnership.feeAmount)} recorded — payment itself is tracked in accounting
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <CardHeader title="Product" icon={<Package size={14} />} />
            <div className="mt-3">
              <ProductEditor partnershipId={partnership.id} products={products} />
            </div>
          </Card>

          <Card id="shipping" className="scroll-mt-4 p-4">
            <CardHeader title="Shipping" icon={<MapPin size={14} />} />
            <div className="mt-3 space-y-3">
              {partnership.addressLine1 || partnership.city || partnership.addressRaw ? (
                <pre className="whitespace-pre-wrap font-sans text-sm text-text">
                  {formatAddress(partnership) || partnership.addressRaw}
                </pre>
              ) : addressAlarm ? (
                <Callout tone="warn">No address on file — nothing can ship until there is one.</Callout>
              ) : (
                <p className="text-sm text-text-muted">No address yet.</p>
              )}
              <AddressEditor partnership={partnership} />
              <div className="border-t border-border pt-3">
                <ShipmentControls partnershipId={partnership.id} shipment={shipment} />
                {shipment?.shippedAt && (
                  <div className="mt-2 text-xs text-text-faint">Shipped {shortDate(shipment.shippedAt)}</div>
                )}
              </div>
            </div>
          </Card>

          <Card id="content" className="scroll-mt-4 p-4">
            <CardHeader title="Content" icon={<Clapperboard size={14} />} />
            <div className="mt-3">
              <BriefEditor
                partnershipId={partnership.id}
                briefUrl={partnership.briefUrl}
                briefSentAt={partnership.briefSentAt ? shortDate(partnership.briefSentAt) : null}
              />
            </div>
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              {deliverables.length === 0 ? (
                <p className="text-sm text-text-muted">No videos posted yet.</p>
              ) : (
                deliverables.map((d) => (
                  <a
                    key={d.id}
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-lg border border-border p-2 text-sm transition hover:border-accent-ring"
                  >
                    <span className="truncate text-text">{d.postedAt ? shortDate(d.postedAt) : "posted"}</span>
                    <span className="flex items-center gap-1 tabular text-text-muted">
                      <Eye size={12} /> {compactNumber(d.views)}
                      {d.metricsSource === "apify" && (
                        <Badge tone="muted" title={EST_VIEWS_NOTE}>
                          est
                        </Badge>
                      )}
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

function TimelineEvent({
  e,
}: {
  e: {
    id: string;
    direction: string;
    kind: string;
    channel: string;
    body: string | null;
    occurredAt: Date;
    isMigrated: boolean | null;
    fromAddress: string | null;
    toAddress: string | null;
  };
}) {
  const inbound = e.direction === "inbound";
  const label = e.fromAddress
    ? null
    : inbound
      ? "They replied"
      : e.kind === "initial"
        ? "First message"
        : e.kind === "follow_up"
          ? "Follow-up"
          : "Note";
  return (
    <li className="flex gap-3 text-sm">
      <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${inbound ? "bg-good-strong" : "bg-accent-ring"}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2">
          {e.fromAddress ? (
            <span className="font-medium text-text" title={`From: ${e.fromAddress}`}>
              {displayNames(e.fromAddress)}
              <span className="font-normal text-text-faint"> → </span>
              {displayNames(e.toAddress) || "—"}
            </span>
          ) : (
            <span className="font-medium text-text">{label}</span>
          )}
          <span className="text-xs text-text-faint">
            {e.isMigrated ? "imported from the old sheet — date not recorded" : relativeDays(e.occurredAt)} ·{" "}
            {channelLabel(e.channel)}
          </span>
        </div>
        {e.body && e.body !== "migrated from sheet; original date unknown" && (
          <p className="mt-0.5 whitespace-pre-wrap text-text-muted">{e.body}</p>
        )}
      </div>
    </li>
  );
}
