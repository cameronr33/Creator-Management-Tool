import Link from "next/link";
import { scheduleEmailCheckForVisitor } from "@/lib/page-email-check";
import { notFound } from "next/navigation";
import {
  ExternalLink,
  Mail,
  ArrowLeft,
  ArrowRight,
  Eye,
  MapPin,
  Package,
  Clapperboard,
  MessageSquare,
  Handshake,
  FlaskConical,
} from "lucide-react";
import { getPartnershipDetail, getClients } from "@/lib/queries";
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
} from "@/components/partnership-actions";
import {
  EditableProfile,
  SocialsEditor,
  EmailsEditor,
  AddressEditor,
  ProductEditor,
} from "@/components/profile-editors";
import { ReplyButton, MessagedButton } from "@/components/reply-button";
import { RereadEmailsButton } from "@/components/email-status";
import { EmailStatusLines } from "@/components/email-status-lines";
import { undoableMoves } from "@/lib/email-status";
import { getCreatorEmails } from "@/lib/creator-emails";
import { compactNumber, fullNumber, money, shortDate, relativeDays } from "@/lib/format";
import { channelLabel } from "@/lib/outreach";
import { formatAddress } from "@/lib/address";
import { displayNames } from "@/lib/email-body";
import { AUTO_STAGE_RULES, type AutoStageTrigger } from "@/lib/auto-stage";
import { AUTO_TRIGGER_LABELS, stageLabel, stageIndex } from "@/lib/stages";
import { nextStep } from "@/lib/next-step";
import { EST_VIEWS_NOTE, VERIFIED_VIEWS_NOTE } from "@/lib/copy";
import { CreatorHashNavigation } from "@/components/creator-hash-navigation";
import { CREATOR_SECTIONS, creatorSection, creatorSectionHref, safeCreatorReturnTo, shipmentAttentionStatus, shipmentSummary, timelineSource, type CreatorSection } from "@/lib/creator-workspace";
import type { CmOutreachEvent } from "@/lib/db/schema";

const TIMELINE_PREVIEW = 5;

export default async function CreatorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[]; returnTo?: string | string[] }>;
}) {
  await scheduleEmailCheckForVisitor();
  const { id } = await params;
  const query = await searchParams;
  const section = creatorSection(query.tab);
  const returnTo = safeCreatorReturnTo(query.returnTo);
  const sectionHref = (target: CreatorSection) => creatorSectionHref(id, target, returnTo);
  const detail = await getPartnershipDetail(id);
  if (!detail) notFound();

  const { creator, partnership, campaign, socials, events, products, shipments, deliverables, outreach, otherPartnerships } =
    detail;
  const [clients, creatorEmails, gmailAccount, undoable] = await Promise.all([
    getClients(),
    getCreatorEmails(creator.id),
    getActiveGmailAccount(),
    undoableMoves([partnership.id]),
  ]);
  const client = clients.find((item) => item.id === creator.clientId);

  const hasAddress = !!(partnership.addressLine1 && partnership.city && partnership.region && partnership.postalCode);
  const step = nextStep({
    stage: partnership.stage,
    hasAddress,
    shipmentStatus: shipmentAttentionStatus(shipments),
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

  const visibleEvents = events.slice(0, TIMELINE_PREVIEW);
  const hiddenEvents = events.slice(TIMELINE_PREVIEW);
  const addressAlarm = !hasAddress && stageIndex(partnership.stage) >= stageIndex("awaiting_address");

  return (
    <div>
      <CreatorHashNavigation id={id} section={section} returnTo={returnTo} />
      {/* Header */}
      <div className="border-b border-border bg-surface px-6 py-4">
        <Link href={returnTo} className="mb-3 inline-flex items-center gap-1 text-sm text-text-muted hover:text-accent">
          <ArrowLeft size={14} /> {returnTo.split("?")[0] === "/" ? "Today" : "Creators"}
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
                  <a href={`mailto:${creator.businessEmail}`} className="inline-flex min-w-0 items-center gap-1 break-all hover:text-accent">
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
                      <Link key={p.id} href={creatorSectionHref(p.id, "overview", returnTo)} className="rounded-md bg-surface-2 px-1.5 py-0.5 hover:text-accent">
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
                      <Link href={sectionHref(step.anchor === "stage" ? "overview" : step.anchor)} className="font-medium underline">
                        Open {step.anchor === "stage" ? "stage" : step.anchor}
                      </Link>
                    </>
                  )}
                </span>
              </div>
              <EmailStatusLines
                partnershipId={partnership.id}
                stage={partnership.stage}
                summary={partnership.emailSummary}
                summaryAt={partnership.emailSummaryAt}
                whoseTurn={partnership.emailWhoseTurn}
                soundsLikeNo={partnership.emailSoundsLikeNo}
                move={undoable.get(partnership.id) ?? null}
              />
            </div>
          </div>
          <Link href={sectionHref("profile")} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm font-medium text-text hover:bg-surface-2">
            Profile & research <ArrowRight size={14} />
          </Link>
        </div>
        <nav aria-label="Creator sections" className="-mb-4 mt-4 flex gap-1 overflow-x-auto">
          {CREATOR_SECTIONS.map((item) => (
            <Link
              key={item.value}
              href={sectionHref(item.value)}
              aria-current={section === item.value ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition ${section === item.value ? "border-accent text-accent" : "border-transparent text-text-muted hover:border-border-strong hover:text-text"}`}
            >
              {item.label}
              {item.value === "conversation" && events.length > 0 && <span className="ml-1.5 text-xs">{events.length}</span>}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        {section === "overview" && (
          <div id="overview" className="space-y-5 scroll-mt-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { title: "Agreement", value: partnership.agreementType === "signed" ? "Signed" : partnership.agreementType === "verbal" ? "Verbal agreement" : "Not recorded", note: partnership.compensationType === "free_product" ? "Product only" : partnership.feeAmount ? `${money(partnership.feeAmount)} fee recorded` : "Compensation not recorded", tab: "agreement" as const },
                { title: "Shipping", value: shipmentSummary(shipments), note: hasAddress ? "Address on file" : "Address incomplete", tab: "shipping" as const },
                { title: "Content", value: `${deliverables.length} posted ${deliverables.length === 1 ? "video" : "videos"}`, note: partnership.briefSentAt ? `Brief sent ${shortDate(partnership.briefSentAt)}` : partnership.briefUrl ? "Brief saved, not marked sent" : "No brief recorded", tab: "content" as const },
                { title: "Conversation", value: outreach.hasReplied ? "Reply recorded" : outreach.totalOutbound ? "Waiting on a reply" : "Not contacted", note: `${outreach.totalOutbound} outbound ${outreach.totalOutbound === 1 ? "message" : "messages"} recorded`, tab: "conversation" as const },
              ].map((track) => (
                <Link key={track.title} href={sectionHref(track.tab)} className="rounded-xl border border-border bg-surface p-4 shadow-card transition hover:border-accent-ring">
                  <div className="flex items-center justify-between text-xs font-medium text-text-muted">{track.title}<ArrowRight size={13} /></div>
                  <div className="mt-2 text-sm font-semibold text-text">{track.value}</div>
                  <div className="mt-1 text-xs text-text-muted">{track.note}</div>
                </Link>
              ))}
            </div>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <Card className="p-4">
                <CardHeader title="Latest activity" description="Recorded messages and notes. A reply alone does not confirm an agreement." actions={<Link href={sectionHref("conversation")} className="text-xs font-medium text-accent hover:underline">Open conversation</Link>} />
                {events.length ? <ul className="mt-4 space-y-4">{events.slice(0, 3).map((e) => <TimelineEvent key={e.id} e={e} compact />)}</ul> : <p className="mt-4 text-sm text-text-muted">No messages or notes recorded yet.</p>}
              </Card>
              <Card className="p-4">
                <CardHeader title="Stage & automation" description="Change the stage when your review confirms progress." />
                <div className="mt-3"><StageControl partnershipId={partnership.id} stage={partnership.stage} exitReason={partnership.exitReason} autoNote={autoNote} /></div>
              </Card>
            </div>
            {shipments.length > 1 && <Callout tone="warn">There are {shipments.length} shipment records on this partnership. Review every record in Shipping before deciding what remains to send.</Callout>}
            <p className="text-xs text-text-faint">These summaries reflect recorded facts. Confirm the agreed deliverables before marking complete. Fees are recorded here; payment is tracked in accounting.</p>
          </div>
        )}

        {section === "conversation" && (
          <Card id="conversation" className="scroll-mt-4 p-4">
            <CardHeader
              title="Conversation"
              icon={<MessageSquare size={14} />}
              description="Email sync records messages visible to the connected mailbox. Messages sent elsewhere and replies that omit that mailbox may be missing."
              actions={
                <>
                  {conversationBadge}
                  <MessagedButton partnershipId={partnership.id} name={creator.name} hasOutbound={outreach.totalOutbound > 0} />
                  <ReplyButton partnershipId={partnership.id} name={creator.name} />
                  {events.some((e) => e.channel === "email") && <RereadEmailsButton partnershipId={partnership.id} />}
                </>
              }
            />
            <p className="mt-3 text-xs text-text-muted">{gmailAccount ? `Connected mailbox: ${gmailAccount.email}.` : "No Gmail mailbox is connected."} {events.length === 100 ? "Showing the latest 100 events." : `${events.length} recorded ${events.length === 1 ? "event" : "events"}.`} Imported messages with unknown dates are labeled.</p>

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
              <TimelineNote partnershipId={partnership.id} hasOutbound={outreach.totalOutbound > 0} />
            </div>
          </Card>
        )}

        {section === "profile" && (
          <div id="profile" className="space-y-5 scroll-mt-4">
          <Card className="p-4">
            <CardHeader title="Creator profile" description="Identity, social accounts and contact addresses are shared across this creator's campaigns." />
            <div className="mt-4 space-y-4">
              <EditableProfile creator={creator} />
              <div><h3 className="mb-2 text-xs font-medium text-text-muted">Social profiles</h3><SocialsEditor creatorId={creator.id} socials={socials} /></div>
              <div><h3 className="mb-2 text-xs font-medium text-text-muted">Other email addresses used for matching</h3><EmailsEditor creatorId={creator.id} emails={creatorEmails} /></div>
              {creator.notes && <p className="whitespace-pre-wrap border-t border-border pt-3 text-sm text-text-muted">{creator.notes}</p>}
              <p className="text-xs text-text-faint">Profile refreshed: {creator.lastRefreshedAt ? shortDate(creator.lastRefreshedAt) : "not recorded"}. Research updated: {creator.researchedAt ? shortDate(creator.researchedAt) : "not recorded"}.</p>
            </div>
          </Card>
          <Card className="p-4">
            <CardHeader
              title="Numbers"
              icon={<FlaskConical size={14} />}
              description="From Instagram or an imported research file."
            />
            <div className="mt-3 grid grid-cols-3 gap-3 xl:grid-cols-6">
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

          </div>
        )}

        {section === "agreement" && (
          <Card id="agreement" className="scroll-mt-4 p-4">
            <CardHeader title="Agreement" icon={<Handshake size={14} />} description="Record the terms you confirmed with the creator. Payment is tracked in accounting." />
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
        )}

        {section === "shipping" && (
          <div id="shipping" className="grid gap-5 scroll-mt-4 lg:grid-cols-2">
          <Card className="p-4">
            <CardHeader title="Product" icon={<Package size={14} />} />
            <div className="mt-3">
              <ProductEditor partnershipId={partnership.id} products={products} />
            </div>
          </Card>

          <Card className="p-4">
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
              <AddressEditor
                partnership={partnership}
                suggested={partnership.suggestedAddress ? { text: partnership.suggestedAddress, when: partnership.emailSummaryAt ? shortDate(partnership.emailSummaryAt) : null } : null}
              />
            </div>
          </Card>
          <Card className="p-4 lg:col-span-2">
            <CardHeader title="Shipment records" description={shipmentSummary(shipments)} />
            {shipments.length > 1 && <div className="mt-3"><Callout tone="warn">Multiple records need review. Check tracking and dates to distinguish separate parcels from duplicates.</Callout></div>}
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {shipments.length ? shipments.map((shipment, index) => (
                <div key={shipment.id} className="space-y-3 rounded-lg border border-border p-3">
                  <h3 className="text-sm font-semibold text-text">Shipment {index + 1}{shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ""}</h3>
                  <ShipmentControls partnershipId={partnership.id} shipment={shipment} />
                  <div className="text-xs text-text-muted">{shipment.shippedAt ? `Shipped ${shortDate(shipment.shippedAt)}` : "Ship date not recorded"}{shipment.deliveredAt ? ` · Delivered ${shortDate(shipment.deliveredAt)}` : ""}</div>
                  {shipment.notes && <p className="whitespace-pre-wrap text-sm text-text-muted">{shipment.notes}</p>}
                </div>
              )) : <ShipmentControls partnershipId={partnership.id} shipment={null} />}
            </div>
          </Card>
          </div>
        )}

        {section === "content" && (
          <Card id="content" className="scroll-mt-4 p-4">
            <CardHeader title="Content" icon={<Clapperboard size={14} />} description="Brief and published videos. Review the agreed terms to confirm whether more content is owed." />
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
        )}
      </div>
    </div>
  );
}

function TimelineEvent({
  e,
  compact = false,
}: {
  e: CmOutreachEvent;
  compact?: boolean;
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
            {e.isMigrated ? "date not recorded" : `${shortDate(e.occurredAt)} · ${relativeDays(e.occurredAt)}`} ·{" "}
            {channelLabel(e.channel)}
          </span>
          <Badge tone="muted">{timelineSource(e)}</Badge>
        </div>
        {e.subject && <p className="mt-1 text-sm font-medium text-text">{e.subject}</p>}
        {e.body && e.body !== "migrated from sheet; original date unknown" && (
          <p className={`mt-0.5 whitespace-pre-wrap break-words text-text-muted ${compact ? "line-clamp-3" : ""}`}>{e.body}</p>
        )}
        {!compact && e.externalId && <details className="mt-1 text-xs text-text-faint"><summary className="cursor-pointer hover:text-accent">Source details</summary><p className="mt-1 break-all">Message ID: {e.externalId}{e.threadId ? ` · Thread ID: ${e.threadId}` : ""}</p></details>}
      </div>
    </li>
  );
}
