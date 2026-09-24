"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight, Mail, MapPin, MessageCircle, PackageCheck, Truck, Clapperboard, ArrowRight } from "lucide-react";
import { Avatar, Badge, Button, Card } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import { QuickStage } from "@/components/quick-stage";
import { MessagedButton } from "@/components/reply-button";
import { CloseAsDeclinedButton, NoReplyNeededButton } from "@/components/email-status";
import { VideoLinkPrompt } from "@/components/partnership-actions";
import { TODAY_SECTIONS, type TodaySection } from "@/lib/today";
import type { TodayRow } from "@/lib/today-data";
import { whoseTurnText } from "@/lib/activity";
import { parseAddress } from "@/lib/address";
import { creatorSectionHref, type CreatorSection } from "@/lib/creator-workspace";
import { relativeDays } from "@/lib/format";

/**
 * Today, as sections of work. Every row: who, which campaign, what was said
 * last and whose turn it is, a stage menu to fix the stage in place, and the
 * one button for the next step. "Waiting on them" starts folded.
 */
export function TodayList({ rows }: { rows: TodayRow[] }) {
  const [openWaiting, setOpenWaiting] = useState(false);
  const bySection = new Map<TodaySection, TodayRow[]>();
  for (const r of rows) bySection.set(r.section, [...(bySection.get(r.section) ?? []), r]);
  const shown = TODAY_SECTIONS.filter((s) => (bySection.get(s.key)?.length ?? 0) > 0);

  return (
    <div className="space-y-4">
      {shown.map((s) => {
        const list = bySection.get(s.key)!;
        const folded = s.key === "waiting" && !openWaiting;
        return (
          <Card key={s.key} className="overflow-hidden" id={`today-${s.key}`}>
            {s.key === "waiting" ? (
              <button
                type="button"
                className="w-full border-b border-border px-4 py-3 text-left hover:bg-surface-2/60"
                onClick={() => setOpenWaiting((v) => !v)}
                aria-expanded={openWaiting}
              >
                <SectionHeading title={s.title} hint={s.hint} count={list.length} folded={folded} />
              </button>
            ) : (
              <div className="border-b border-border px-4 py-3">
                <SectionHeading title={s.title} hint={s.hint} count={list.length} />
              </div>
            )}
            {!folded && (
              <ul className="divide-y divide-border">
                {list.map((r) => (
                  <TodayItem key={r.partnershipId} row={r} />
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function SectionHeading({ title, hint, count, folded }: { title: string; hint: string; count: number; folded?: boolean }) {
  return (
    <>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
        {folded !== undefined && (folded ? <ChevronRight size={14} /> : <ChevronDown size={14} />)}
        {title}
        <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-semibold tabular text-text-muted ring-1 ring-inset ring-border">{count}</span>
      </h2>
      <p className="mt-0.5 text-xs text-text-muted">{hint}</p>
    </>
  );
}

function href(r: TodayRow, section: CreatorSection) {
  return creatorSectionHref(r.partnershipId, section, "/");
}

function TodayItem({ row: r }: { row: TodayRow }) {
  const turn = whoseTurnText(r.whoseTurn);
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Avatar name={r.name} src={r.photoUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={href(r, "overview")} className="text-sm font-semibold text-text hover:text-accent">
              {r.name}
            </Link>
            <span className="text-xs text-text-muted">@{r.username}</span>
            <Badge tone="info" title="Campaign">{r.campaignName}</Badge>
            {turn && r.section !== "your_turn" && r.section !== "waiting" && r.whoseTurn === "us" && <Badge tone="warn">Your turn</Badge>}
          </div>
          <p className="mt-1 text-sm text-text-muted">
            {r.latestFromEmail ? (
              <Mail size={12} className="mr-1 inline align-[-1px] text-text-faint" />
            ) : (
              <MessageCircle size={12} className="mr-1 inline align-[-1px] text-text-faint" />
            )}
            {r.latest}
            {r.latestAt && <span className="text-text-faint"> · {relativeDays(r.latestAt)}</span>}
            {r.section === "waiting" && turn && <span className="text-text-faint"> · {turn.label}</span>}
          </p>
          {r.note && <p className="mt-0.5 text-xs text-text-faint">{r.note}</p>}
          {r.section === "get_address" && r.suggestedAddress && (
            <p className="mt-1 text-xs text-text-muted">
              <MapPin size={12} className="mr-1 inline align-[-1px] text-text-faint" />
              Found in their email: <span className="font-medium text-text">{r.suggestedAddress}</span>
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <NextAction row={r} />
          </div>
        </div>
      </div>
      <div className="sm:w-44 sm:shrink-0">
        <QuickStage partnershipId={r.partnershipId} name={r.name} stage={r.stage} className="w-full" />
      </div>
    </li>
  );
}

/** The one button for this row's next step. */
function NextAction({ row: r }: { row: TodayRow }) {
  switch (r.section) {
    case "your_turn":
      return (
        <>
          <Button size="sm" variant="primary" href={href(r, "conversation")} icon={<ArrowRight size={13} />}>
            Open conversation
          </Button>
          <NoReplyNeededButton partnershipId={r.partnershipId} />
          {r.soundsLikeNo && (
            <>
              <Badge tone="warn">Sounds like a no</Badge>
              <CloseAsDeclinedButton partnershipId={r.partnershipId} />
            </>
          )}
        </>
      );
    case "follow_up":
    case "to_contact":
      return <MessagedButton partnershipId={r.partnershipId} name={r.name} hasOutbound={r.hasOutbound} variant="primary" />;
    case "get_address":
      return r.suggestedAddress ? (
        <UseAddressButton row={r} />
      ) : (
        <Button size="sm" href={href(r, "shipping")} icon={<MapPin size={13} />}>
          Add their address
        </Button>
      );
    case "ready_to_ship":
      return (
        <>
          <ShipmentButton row={r} status="shipped" label="Mark shipped" icon={<Truck size={13} />} />
          <Button size="sm" variant="ghost" href={href(r, "shipping")}>
            Add tracking
          </Button>
        </>
      );
    case "shipped":
      return <ShipmentButton row={r} status="delivered" label="Mark delivered" icon={<PackageCheck size={13} />} />;
    case "waiting_video":
      return <AddVideoButton row={r} />;
    default:
      return null;
  }
}

/** Saves the address found in their email; saving it moves them to Ready to ship. */
function UseAddressButton({ row: r }: { row: TodayRow }) {
  const { pending, run } = useSave();
  const parsed = parseAddress(r.suggestedAddress);
  if (!parsed?.isComplete) {
    return (
      <Button size="sm" href={href(r, "shipping")} icon={<MapPin size={13} />}>
        Check and save the address
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      variant="primary"
      pending={pending}
      icon={<MapPin size={13} />}
      title="Saves this as their shipping address and moves them to Ready to ship"
      onClick={() =>
        run(
          () =>
            api(
              `/api/partnerships/${r.partnershipId}`,
              {
                recipientName: parsed.recipientName,
                addressLine1: parsed.addressLine1,
                addressLine2: parsed.addressLine2,
                city: parsed.city,
                region: parsed.region,
                postalCode: parsed.postalCode,
                country: parsed.country,
                addressRaw: parsed.raw,
              },
              "PATCH",
            ),
          { success: `Address saved for ${r.name}` },
        )
      }
    >
      Use this address
    </Button>
  );
}

function ShipmentButton({ row: r, status, label, icon }: { row: TodayRow; status: "shipped" | "delivered"; label: string; icon: React.ReactNode }) {
  const { pending, run } = useSave();
  return (
    <Button
      size="sm"
      variant="primary"
      pending={pending}
      icon={icon}
      onClick={() =>
        run(() => api("/api/shipments", { id: r.shipmentId ?? undefined, partnershipId: r.partnershipId, status }), {
          success: `${r.name}: ${status === "shipped" ? "shipped" : "delivered"}`,
        })
      }
    >
      {label}
    </Button>
  );
}

function AddVideoButton({ row: r }: { row: TodayRow }) {
  const { pending, run } = useSave();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button size="sm" variant="primary" icon={<Clapperboard size={13} />} onClick={() => setOpen(true)}>
        Add video link
      </Button>
    );
  }
  return (
    <VideoLinkPrompt
      pending={pending}
      onCancel={() => setOpen(false)}
      onSubmit={async (url) => {
        const res = await run(() => api(`/api/partnerships/${r.partnershipId}/stage`, { stage: "posted", videoUrl: url }), {
          success: `${r.name} → Posted`,
        });
        if (res.ok) setOpen(false);
      }}
    />
  );
}
