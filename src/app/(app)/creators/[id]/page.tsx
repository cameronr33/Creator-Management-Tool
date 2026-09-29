import { requireAgencyPage } from "@/lib/page-guards";
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
  User,
  TriangleAlert,
  History as HistoryIcon,
} from "lucide-react";
import { getPartnershipDetail, getClients, getPhotoUrl, getCampaigns, getFollowUpThresholds } from "@/lib/queries";
import { getActiveGmailAccount } from "@/lib/gmail-sync";
import { Card, CardHeader, Avatar, Badge, Callout } from "@/components/ui";
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
import { CampaignPicker, DangerZone } from "@/components/creator-record-actions";
import { ApprovalButtons } from "@/components/approval-buttons";
import { undoableMoves } from "@/lib/email-status";
import { getCreatorEmails } from "@/lib/creator-emails";
import { compactNumber, fullNumber, money, shortDate, relativeDays } from "@/lib/format";
import { channelLabel } from "@/lib/outreach";
import { formatAddress } from "@/lib/address";
import { displayNames } from "@/lib/email-body";
import { groupThreads } from "@/lib/conversation";
import { latestActivity } from "@/lib/activity";
import { AUTO_STAGE_RULES, type AutoStageTrigger } from "@/lib/auto-stage";
import { AUTO_TRIGGER_LABELS, stageLabel, stageIndex } from "@/lib/stages";
import { nextStep } from "@/lib/next-step";
import { EST_VIEWS_NOTE, VERIFIED_VIEWS_NOTE } from "@/lib/copy";
import { creatorSectionHref, safeCreatorReturnTo, shipmentAttentionStatus, shipmentSummary, timelineSource } from "@/lib/creator-workspace";
import type { CmOutreachEvent } from "@/lib/db/schema";
import { governingContract, isStaleRead, listContracts } from "@/lib/contracts";
import { dealDifferences, type DealFacts, type EmailDeal } from "@/lib/deal-facts";
import { Contracts, type ContractRow, type OfferedDifference } from "@/components/contracts";
import { StatusNote } from "@/components/status-note";
import { ArchiveControl, ArchiveLine, RestoreButton } from "@/components/archive";
import { archiveActive } from "@/lib/archive-rules";
import { staleStage, staleStageLine } from "@/lib/stage-flag";
import { lastManualChangeAt } from "@/lib/email-ingest";
import { StageFlagButtons } from "@/components/stage-flag";
import { TrackingLink } from "@/components/tracking-link";
import { OwnerPicker } from "@/components/owner-controls";
import { chipLabels, listLoginNames, listTeammates, memberForUser } from "@/lib/owners";
import { buildHistory, getStageHistory } from "@/lib/history";
import { listedOnToday } from "@/lib/today";
import { StageHistory } from "@/components/stage-history";
import { statusNoteView } from "@/lib/status-note";

/** Where the Next: line's link goes, named for where it lands. */
const NEXT_LINK_LABELS: Record<string, string> = {
  conversation: "Open the conversation",
  agreement: "Open Deal",
  shipping: "Open Shipping",
  content: "Open Content",
};

/** Messages shown per thread before "Show earlier". */
const THREAD_PREVIEW = 2;

const BACK_LABELS: Record<string, string> = { "/": "Today", "/creators": "Creators", "/pipeline": "Pipeline" };

/**
 * One creator, one scrolling page: who they are and what's next at the top,
 * then the conversation, the deal, shipping, content, their profile, and —
 * at the bottom — removing them.
 */
export default async function CreatorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const session = await requireAgencyPage();
  await scheduleEmailCheckForVisitor();
  const { id } = await params;
  const query = await searchParams;
  const returnTo = safeCreatorReturnTo(query.returnTo);
  const detail = await getPartnershipDetail(id);
  if (!detail) notFound();

  const { creator, partnership, campaign, socials, events, products, shipments, deliverables, outreach, otherPartnerships } =
    detail;
  const [clients, creatorEmails, gmailAccount, undoable, photo, campaigns, contracts, teammates, thresholds, historyRows] = await Promise.all([
    getClients(),
    getCreatorEmails(creator.id),
    getActiveGmailAccount(),
    undoableMoves([partnership.id]),
    getPhotoUrl(creator.id),
    getCampaigns(creator.clientId),
    listContracts(partnership.id),
    listTeammates(),
    getFollowUpThresholds(creator.clientId),
    getStageHistory(partnership.id),
  ]);

  // Contracts and their email: where they disagree with what's recorded (blanks were filled already).
  const contractRows: ContractRow[] = contracts.map((c) => ({
    id: c.id,
    source: c.source,
    filename: c.filename,
    sizeBytes: c.sizeBytes,
    received: shortDate(c.receivedAt),
    readStatus: c.readStatus,
    readError: c.readError,
    filled: Array.isArray(c.filled) ? (c.filled as string[]) : [],
    downloaded: c.downloaded,
    signed: !!(c.extracted as DealFacts | null)?.signed,
    givenUp: c.source === "email" && !c.downloaded && c.readStatus === "pending" && c.attempts >= 3,
    stale: isStaleRead(c),
  }));
  const dealNow = { ...partnership, products };
  const dismissed = Array.isArray(partnership.dealDismissed) ? (partnership.dealDismissed as string[]) : [];
  const governing = governingContract(contracts);
  const emailDeal = partnership.emailDeal as EmailDeal | null;
  const differences: OfferedDifference[] = [];
  if (governing) {
    const from = `The contract (${governing.filename})`;
    for (const d of dealDifferences(dealNow, governing.extracted as DealFacts, { dismissed, terms: true })) differences.push({ ...d, from });
  }
  if (emailDeal?.facts) {
    for (const d of dealDifferences(dealNow, emailDeal.facts, { dismissed })) if (!differences.some((x) => x.label === d.label && (x.key === d.key || d.label !== "Product"))) differences.push({ ...d, from: "Their email" });
  }
  const client = clients.find((item) => item.id === creator.clientId);
  const history = buildHistory(historyRows, { clientName: client?.name ?? "the client", undoableId: undoable.get(partnership.id)?.id ?? null });
  // "· by Kieran" on what a teammate logged by hand — logged under their login, so by login id.
  const teammateNames = await listLoginNames();
  const me = await memberForUser(session.user);
  const chip = chipLabels(teammates);
  const team = teammates.map((t) => ({ ...t, label: chip.get(t.id) ?? "?" }));

  const hasAddress = !!(partnership.addressLine1 && partnership.city && partnership.region && partnership.postalCode);
  // Archived? The same rule the lists use, over the messages already loaded.
  const lastInboundStoredAt = events
    .filter((e) => e.direction === "inbound" && e.kind !== "note")
    .reduce<Date | null>((latest, e) => (!latest || e.createdAt > latest ? e.createdAt : latest), null);
  const archived = archiveActive({ ...partnership, lastInboundStoredAt });
  // Their emails read as an earlier stage? (Michael Dey, 2026-09-29.) A person decides; the Next line follows the emails.
  const flagged = staleStage({
    stage: partnership.stage,
    emailStage: partnership.emailStage,
    emailStageAt: partnership.emailStageAt,
    lastManualChangeAt: (await lastManualChangeAt([partnership.id], { peopleOnly: true })).get(partnership.id) ?? null,
    dismissedAt: partnership.stageFlagDismissedAt,
  });
  const step = nextStep({
    staleStage: flagged,
    stage: partnership.stage,
    hasAddress,
    signed: partnership.agreementType === "signed",
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
    nudgeAfterDays: thresholds.nudgeAfterDays,
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
  ];

  const conversationBadge = outreach.hasReplied ? (
    <Badge tone="good">Replied</Badge>
  ) : outreach.totalOutbound > 0 ? (
    <Badge tone="warn">
      {outreach.followUpCount} follow-up{outreach.followUpCount === 1 ? "" : "s"} · no reply
    </Badge>
  ) : (
    <Badge tone="muted">not contacted</Badge>
  );

  const threads = groupThreads(events);
  // Same "whose turn" as Today and the Pipeline: No reply needed and a DM logged
  // after the summary both count. Events are newest first; notes never count.
  const lastReal = [...events]
    .filter((e) => e.kind !== "note")
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || (a.direction === "inbound" ? -1 : 1))[0];
  const activity = latestActivity({
    last: lastReal
      ? { at: lastReal.occurredAt, direction: lastReal.direction, channel: lastReal.channel, senderRole: lastReal.senderRole, subject: lastReal.subject, isMigrated: lastReal.isMigrated }
      : null,
    emailSummary: partnership.emailSummary,
    emailSummaryAt: partnership.emailSummaryAt,
    emailWhoseTurn: partnership.emailWhoseTurn,
    replyHandledAt: partnership.replyHandledAt,
  });
  const addressAlarm = !hasAddress && stageIndex(partnership.stage) >= stageIndex("awaiting_address");
  const anchor = (section: Parameters<typeof creatorSectionHref>[1]) => `#${section}`;

  return (
    <div>
      {/* Header: who, what's next, and the stage */}
      <div className="border-b border-border bg-surface px-4 py-4 sm:px-6">
        <Link href={returnTo} className="mb-3 inline-flex items-center gap-1 text-sm text-text-muted hover:text-accent">
          <ArrowLeft size={14} /> {BACK_LABELS[returnTo.split("?")[0]] ?? "Creators"}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Avatar name={creator.name} size="lg" src={photo} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight text-text">{creator.name}</h1>
                {creator.contentPillar && <Badge tone="accent">{creator.contentPillar}</Badge>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
                {creator.profileUrl ? (
                  <a href={creator.profileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-accent">
                    @{creator.username} <ExternalLink size={12} />
                  </a>
                ) : (
                  <a href={anchor("profile")} className="hover:text-accent">
                    No profile link yet — add one under Profile
                  </a>
                )}
                {creator.businessEmail && (
                  <a href={`mailto:${creator.businessEmail}`} className="inline-flex min-w-0 items-center gap-1 break-all hover:text-accent">
                    <Mail size={12} /> {creator.businessEmail}
                  </a>
                )}
                <span>
                  {client?.name ? `${client.name} · ` : ""}
                  <Badge tone="info" title="Campaign">{campaign.name}</Badge>
                </span>
                {otherPartnerships.length > 0 && (
                  <span className="flex items-center gap-1 text-xs">
                    Also in:
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
                  {step.anchor && step.anchor !== "stage" && (
                    <>
                      {" "}
                      <a href={anchor(step.anchor as Parameters<typeof creatorSectionHref>[1])} className="font-medium underline">
                        {NEXT_LINK_LABELS[step.anchor] ?? "Open it"}
                      </a>
                    </>
                  )}
                </span>
              </div>
              {flagged && (
                <div className="mt-2">
                  <Callout
                    tone="warn"
                    title={staleStageLine(partnership.stage, flagged)}
                    actions={<StageFlagButtons partnershipId={partnership.id} name={creator.name} stage={partnership.stage} suggested={flagged} />}
                  >
                    {partnership.emailStageQuote ? <>&ldquo;{partnership.emailStageQuote}&rdquo;</> : "From their latest emails."} Nothing moves backward by itself — move them, or keep the stage.
                  </Callout>
                </div>
              )}
              <EmailStatusLines
                partnershipId={partnership.id}
                stage={partnership.stage}
                summary={partnership.emailSummary}
                summaryAt={partnership.emailSummaryAt}
                whoseTurn={activity.whoseTurn}
                soundsLikeNo={partnership.emailSoundsLikeNo}
                move={undoable.get(partnership.id) ?? null}
              />
              <div className="mt-2">
                <StatusNote partnershipId={partnership.id} note={statusNoteView(partnership)} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                {archived ? (
                  <>
                    <span>
                      <ArchiveLine until={partnership.archivedUntil?.toISOString() ?? null} by={partnership.archivedByName} reason={partnership.archiveReason} />
                    </span>
                    <RestoreButton partnershipId={partnership.id} name={creator.name} />
                  </>
                ) : listedOnToday(partnership.stage) ? (
                  <ArchiveControl partnershipId={partnership.id} name={creator.name} label="Archive" />
                ) : null}
              </div>
              {partnership.clientApproval === "pending" ? (
                <div className="mt-2">
                  <Callout tone="warn" title={`Waiting on ${client?.name ?? "the client"}'s approval`} actions={<ApprovalButtons partnershipId={partnership.id} name={creator.name} who="agency" />}>
                    Hold off reaching out until they approve — in their portal, or approve for them here.
                  </Callout>
                </div>
              ) : partnership.clientApproval ? (
                <p className="mt-2 text-xs text-text-muted">
                  {partnership.clientApproval === "approved" ? "Approved for outreach" : "Passed on"} by {partnership.approvalByName ?? "someone"}
                  {partnership.approvalAt ? ` on ${shortDate(partnership.approvalAt)}` : ""}
                  {partnership.approvalNote ? <>: &ldquo;{partnership.approvalNote}&rdquo;</> : null}
                </p>
              ) : null}
            </div>
          </div>
          <div className="w-full space-y-3 sm:w-72">
            <StageControl partnershipId={partnership.id} stage={partnership.stage} exitReason={partnership.exitReason} autoNote={autoNote} />
            <CampaignPicker partnershipId={partnership.id} campaignId={campaign.id} campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))} />
            <OwnerPicker partnershipId={partnership.id} ownerId={partnership.ownerId} teammates={team} meId={me?.id ?? null} />
          </div>
        </div>
        <nav aria-label="Jump to" className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {[
            ["conversation", `Conversation${events.length ? ` (${events.length})` : ""}`],
            ["agreement", "Deal"],
            ["shipping", "Shipping"],
            ["content", "Content"],
            ["history", "History"],
            ["profile", "Profile"],
          ].map(([key, label]) => (
            <a key={key} href={`#${key}`} className="text-text-muted hover:text-accent">
              {label}
            </a>
          ))}
        </nav>
      </div>

      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
        {/* Conversation, grouped by email thread */}
        <Card id="conversation" className="scroll-mt-4 p-4">
          <CardHeader
            title="Conversation"
            icon={<MessageSquare size={14} />}
            description={`${gmailAccount ? `Email with their saved addresses is picked up from ${gmailAccount.email} by itself.` : "No mailbox is connected, so email isn't tracked yet."} Log Instagram DMs with I messaged them / They replied.`}
            actions={
              <>
                {conversationBadge}
                <MessagedButton partnershipId={partnership.id} name={creator.name} hasOutbound={outreach.totalOutbound > 0} />
                <ReplyButton partnershipId={partnership.id} name={creator.name} />
                {events.some((e) => e.channel === "email" && e.externalId) && <RereadEmailsButton partnershipId={partnership.id} />}
              </>
            }
          />
          {threads.length === 0 ? (
            <p className="mt-3 text-sm text-text-muted">Nothing yet.</p>
          ) : (
            <div className="mt-4 space-y-4">
              {threads.map((t) => {
                const recent = t.events.slice(-THREAD_PREVIEW);
                const earlier = t.events.slice(0, -THREAD_PREVIEW);
                return (
                  <section key={t.key} className="rounded-lg border border-border">
                    <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border bg-surface-2/50 px-3 py-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-text">{t.title}</h3>
                        <p className="text-xs text-text-muted">
                          {t.events.length} message{t.events.length === 1 ? "" : "s"} · last {relativeDays(t.lastAt)}
                          {t.participants.length > 0 && <> · {t.participants.slice(0, 4).join(", ")}{t.participants.length > 4 ? ` +${t.participants.length - 4}` : ""}</>}
                        </p>
                      </div>
                      {t.gmailUrl && (
                        <a href={t.gmailUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                          Open in Gmail <ExternalLink size={11} />
                        </a>
                      )}
                    </header>
                    <ul className="space-y-3 p-3">
                      {earlier.length > 0 && (
                        <li>
                          <details>
                            <summary className="cursor-pointer text-xs font-medium text-text-muted hover:text-accent">Show {earlier.length} earlier</summary>
                            <ul className="mt-3 space-y-3">
                              {earlier.map((e) => (
                                <TimelineEvent key={e.id} e={e} clientName={client?.name ?? "the client"} names={teammateNames} />
                              ))}
                            </ul>
                          </details>
                        </li>
                      )}
                      {recent.map((e) => (
                        <TimelineEvent key={e.id} e={e} clientName={client?.name ?? "the client"} names={teammateNames} />
                      ))}
                    </ul>
                  </section>
                );
              })}
              {events.length === 100 && <p className="text-xs text-text-faint">Showing the latest 100 messages.</p>}
            </div>
          )}
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <TimelineNote partnershipId={partnership.id} hasOutbound={outreach.totalOutbound > 0} />
          </div>
        </Card>

        {/* The deal */}
        <Card id="agreement" className="scroll-mt-4 p-4">
          <CardHeader title="Deal" icon={<Handshake size={14} />} description="What you agreed: verbal or signed, product and fee, the videos. A contract PDF fills in whatever is blank. Payment itself is tracked in accounting." />
          <div className="mt-3 space-y-3">
            <Contracts partnershipId={partnership.id} contracts={contractRows} differences={differences} />
            <AgreementEditor
              partnershipId={partnership.id}
              agreementType={partnership.agreementType}
              agreedTerms={partnership.agreedTerms}
              notes={partnership.notes}
            />
            <div className="border-t border-border pt-3">
              <FeeEditor partnershipId={partnership.id} feeAmount={partnership.feeAmount} compensationType={partnership.compensationType} />
              {partnership.feeAmount && partnership.compensationType !== "free_product" && (
                <div className="mt-1 text-xs text-text-faint">{money(partnership.feeAmount)} recorded</div>
              )}
            </div>
          </div>
        </Card>

        {/* Shipping */}
        <div id="shipping" className="grid scroll-mt-4 gap-5 lg:grid-cols-2">
          <Card className="p-4">
            <CardHeader title="Shipping address" icon={<MapPin size={14} />} description="Saving a complete address moves an Agreed creator to Ready to ship." />
            <div className="mt-3 space-y-3">
              {partnership.addressLine1 || partnership.city || partnership.addressRaw ? (
                <pre className="whitespace-pre-wrap font-sans text-sm text-text">{formatAddress(partnership) || partnership.addressRaw}</pre>
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
          <Card className="p-4">
            <CardHeader title="Product" icon={<Package size={14} />} />
            <div className="mt-3">
              <ProductEditor partnershipId={partnership.id} products={products} />
            </div>
          </Card>
          <Card className="p-4 lg:col-span-2">
            <CardHeader title="Shipment" description={`${shipmentSummary(shipments)}. Marking it shipped moves them to Shipped; delivered moves them to Waiting on video.`} />
            {shipments.length > 1 && (
              <div className="mt-3">
                <Callout tone="warn">There are {shipments.length} shipment records. Check tracking and dates to tell separate parcels from duplicates.</Callout>
              </div>
            )}
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {shipments.length ? (
                shipments.map((shipment, index) => (
                  <div key={shipment.id} className="space-y-3 rounded-lg border border-border p-3">
                    {shipments.length > 1 && (
                      <h3 className="text-sm font-semibold text-text">
                        Shipment {index + 1}
                        {shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ""}
                      </h3>
                    )}
                    <ShipmentControls partnershipId={partnership.id} shipment={shipment} />
                    <div className="text-xs text-text-muted">
                      {shipment.shippedAt ? `Shipped ${shortDate(shipment.shippedAt)}` : "Not shipped yet"}
                      {shipment.deliveredAt ? ` · Delivered ${shortDate(shipment.deliveredAt)}` : ""}
                      {shipment.trackingNumber && (
                        <>
                          {" · "}
                          <TrackingLink carrier={shipment.carrier} number={shipment.trackingNumber} label="Track it" />
                        </>
                      )}
                    </div>
                    {shipment.notes && <p className="whitespace-pre-wrap text-sm text-text-muted">{shipment.notes}</p>}
                  </div>
                ))
              ) : (
                <ShipmentControls partnershipId={partnership.id} shipment={null} />
              )}
            </div>
          </Card>
        </div>

        {/* Content */}
        <Card id="content" className="scroll-mt-4 p-4">
          <CardHeader title="Content" icon={<Clapperboard size={14} />} description="The brief, and the videos they posted. Adding a video link moves them to Posted." />
          <div className="mt-3">
            <BriefEditor partnershipId={partnership.id} briefUrl={partnership.briefUrl} briefSentAt={partnership.briefSentAt ? shortDate(partnership.briefSentAt) : null} />
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

        {/* Stage history — every move, who or what made it; folded */}
        <Card id="history" className="scroll-mt-4 p-4">
          <details>
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-text">
              <HistoryIcon size={14} /> Stage history{history.length ? ` (${history.length})` : ""}
              <span className="text-xs font-normal text-text-muted">Every move, who or what made it, and anything undone</span>
            </summary>
            <div className="mt-4">
              <StageHistory partnershipId={partnership.id} items={history} />
            </div>
          </details>
        </Card>

        {/* Profile — folded unless something's missing */}
        <Card id="profile" className="scroll-mt-4 p-4">
          <details open={!creator.profileUrl}>
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-text">
              <User size={14} /> Profile
              <span className="text-xs font-normal text-text-muted">Name, links, email addresses and numbers — shared across their campaigns</span>
            </summary>
            <div className="mt-4 space-y-4">
              <EditableProfile creator={creator} />
              <div>
                <h3 className="mb-2 text-xs font-medium text-text-muted">Profile links</h3>
                <SocialsEditor creatorId={creator.id} socials={socials} />
              </div>
              <div>
                <h3 className="mb-2 text-xs font-medium text-text-muted">Other email addresses we track</h3>
                <EmailsEditor creatorId={creator.id} emails={creatorEmails} />
              </div>
              {creator.notes && <p className="whitespace-pre-wrap border-t border-border pt-3 text-sm text-text-muted">{creator.notes}</p>}
              <div className="border-t border-border pt-3">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-muted">
                  <FlaskConical size={13} /> Numbers
                </h3>
                <div className="grid grid-cols-3 gap-3 xl:grid-cols-5">
                  {metrics.map((m) => (
                    <div key={m.label}>
                      <div className="text-xs text-text-muted">{m.label}</div>
                      <div className="tabular text-base font-semibold text-text">{m.value}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  {creator.viewsSource === "ig_public_chrome" ? (
                    <Badge tone="good" title={VERIFIED_VIEWS_NOTE}>
                      verified views
                    </Badge>
                  ) : creator.viewsSource === "apify" ? (
                    <Badge tone="muted" title={EST_VIEWS_NOTE}>
                      estimated views
                    </Badge>
                  ) : null}
                  <span>Refreshed from Instagram: {creator.lastRefreshedAt ? shortDate(creator.lastRefreshedAt) : "never"}</span>
                </div>
                {creator.contentTypeSummary && <p className="mt-3 text-sm leading-relaxed text-text-muted">{creator.contentTypeSummary}</p>}
              </div>
            </div>
          </details>
        </Card>

        {/* Removing them */}
        <Card className="border-bad-line p-4">
          <CardHeader title="Remove" icon={<TriangleAlert size={14} />} description="Taking someone off a campaign deletes that campaign's conversation, shipping and videos for them." />
          <div className="mt-3">
            <DangerZone
              partnershipId={partnership.id}
              creatorId={creator.id}
              name={creator.name}
              campaignName={campaign.name}
              otherCampaigns={otherPartnerships.map((p) => p.campaignName)}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function TimelineEvent({ e, clientName, names }: { e: CmOutreachEvent; clientName: string; names: Map<string, string> }) {
  const inbound = e.direction === "inbound";
  // Logged in the app by a teammate (never on mail the mailbox holds or rows from the old sheet).
  const loggedBy = !e.externalId && !e.isMigrated && e.createdBy ? names.get(e.createdBy) ?? null : null;
  const fromClient = e.senderRole === "client";
  const label = e.fromAddress
    ? null
    : e.kind === "note"
      ? "Note"
      : inbound
        ? "They replied"
        : e.kind === "initial"
          ? "First message"
          : e.kind === "follow_up"
            ? "Follow-up"
            : "We messaged them";
  return (
    <li className="flex gap-3 text-sm">
      <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${fromClient ? "bg-info" : e.kind === "note" ? "bg-border-strong" : inbound ? "bg-good-strong" : "bg-accent-ring"}`} />
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
            {e.isMigrated ? "date not recorded" : `${shortDate(e.occurredAt)} · ${relativeDays(e.occurredAt)}`} · {channelLabel(e.channel)}
            {loggedBy && ` · by ${loggedBy}`}
          </span>
          {fromClient ? (
            <Badge tone="info">From {clientName}</Badge>
          ) : (
            e.kind === "note" && e.fromAddress && <Badge tone="muted">invite / automatic</Badge>
          )}
          {e.isMigrated && <Badge tone="muted">{timelineSource(e)}</Badge>}
        </div>
        {e.body && e.body !== "migrated from sheet; original date unknown" && (
          <p className="mt-0.5 line-clamp-6 whitespace-pre-wrap break-words text-text-muted">{e.body}</p>
        )}
      </div>
    </li>
  );
}
