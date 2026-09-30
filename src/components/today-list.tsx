"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Archive, CalendarClock, Check, ChevronDown, ChevronRight, Mail, MapPin, MessageCircle, NotebookPen, PackageCheck, Truck, Clapperboard, ArrowRight } from "lucide-react";
import { Avatar, Badge, Button, Card, SectionTitle } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import { QuickStage } from "@/components/quick-stage";
import { StatusNote } from "@/components/status-note";
import { OwnerMenu, type TeammateOption } from "@/components/owner-controls";
import { ArchiveControl } from "@/components/archive";
import { MessagedButton, ReplyButton } from "@/components/reply-button";
import { LogMessagePanel } from "@/components/log-message";
import { Menu, MenuItem } from "@/components/menu";
import { CloseAsDeclinedButton, NoReplyNeededButton } from "@/components/email-status";
import { VideoLinkPrompt } from "@/components/partnership-actions";
import { ApprovalButtons } from "@/components/approval-buttons";
import { StageFlagButtons } from "@/components/stage-flag";
import { TODAY_SECTIONS, type TodaySection } from "@/lib/today";
import type { TodayRow } from "@/lib/today-data";
import { whoseTurnText } from "@/lib/activity";
import { parseAddress } from "@/lib/address";
import { creatorSectionHref, type CreatorSection } from "@/lib/creator-workspace";
import { relativeDays } from "@/lib/format";

/**
 * Today, as sections of work. Every row: who, their stage as a pill (click it
 * to change the stage), what was said last and whose turn it is, the one
 * button for the next step, and a ⋯ menu for the rest (log with a date, a
 * note, archive). The
 * campaign shows only when the sidebar is on All campaigns. "Waiting on them"
 * starts folded.
 */
export function TodayList({
  rows,
  meId,
  team,
  showCampaign = true,
}: {
  rows: TodayRow[];
  meId: string | null;
  team: TeammateOption[];
  showCampaign?: boolean;
}) {
  // "Waiting on them" starts folded: nothing to do there today.
  const [open, setOpen] = useState<Set<TodaySection>>(new Set());
  const bySection = groupBySection(rows);

  // A row that leaves its section (it moved on, or off Today) stays a moment
  // to say where it went, then folds away; the section it went to pulses
  // (interaction review 2026-09-30, I4).
  const [seenRows, setSeenRows] = useState(rows);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [pulse, setPulse] = useState<{ section: TodaySection; n: number } | null>(null);
  // Rows you pressed something on in the last minute. A row that vanished
  // without that just left the view (Mine / Everyone, another campaign or
  // client) — it isn't "Done" (review 2026-09-30).
  const [acted, setActed] = useState<Set<string>>(() => new Set());
  const markActed = (id: string) => {
    setActed((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    setTimeout(
      () =>
        setActed((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
      60_000,
    );
  };
  if (seenRows !== rows) {
    const now = new Map(rows.map((r) => [r.partnershipId, r]));
    const before = groupBySection(seenRows);
    const left: Ghost[] = [];
    for (const r of seenRows) {
      const next = now.get(r.partnershipId);
      if (next && next.section === r.section) continue;
      if (!next && !acted.has(r.partnershipId)) continue;
      left.push({ row: r, to: next?.section ?? null, index: before.get(r.section)?.indexOf(r) ?? 0 });
    }
    setSeenRows(rows);
    if (left.length) {
      setGhosts(left);
      const to = left.find((g) => g.to)?.to;
      if (to) setPulse((p) => ({ section: to, n: (p?.n ?? 0) + 1 }));
    }
  }
  useEffect(() => {
    if (!ghosts.length) return;
    const t = setTimeout(() => setGhosts([]), 850); // 450ms hold + 320ms fold, then gone
    return () => clearTimeout(t);
  }, [ghosts]);

  const shown = TODAY_SECTIONS.filter((s) => (bySection.get(s.key)?.length ?? 0) > 0 || ghosts.some((g) => g.row.section === s.key));

  return (
    <div className="space-y-4">
      {shown.map((s) => {
        const list = bySection.get(s.key) ?? [];
        const foldable = s.key === "waiting";
        const folded = foldable && !open.has(s.key);
        // Real rows, with any that just left put back where they were.
        const items: ({ ghost: false; row: TodayRow } | ({ ghost: true } & Ghost))[] = list.map((row) => ({ ghost: false as const, row }));
        for (const g of ghosts.filter((x) => x.row.section === s.key)) items.splice(Math.min(g.index, items.length), 0, { ghost: true, ...g });
        return (
          <div key={s.key} className="relative">
          {pulse?.section === s.key && <span key={pulse.n} aria-hidden className="pointer-events-none absolute inset-0 animate-ring-pulse rounded-xl" />}
          <Card className="overflow-hidden" id={`today-${s.key}`}>
            {foldable ? (
              <button
                type="button"
                className="w-full border-b border-border px-4 py-3 text-left hover:bg-surface-2/60"
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(s.key)) next.delete(s.key);
                    else next.add(s.key);
                    return next;
                  })
                }
                aria-expanded={!folded}
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
                {items.map((it) =>
                  it.ghost ? (
                    <GhostRow key={`left-${it.row.partnershipId}`} ghost={it} />
                  ) : (
                    <TodayItem key={it.row.partnershipId} row={it.row} meId={meId} team={team} showCampaign={showCampaign} onActed={markActed} />
                  ),
                )}
              </ul>
            )}
          </Card>
          </div>
        );
      })}
    </div>
  );
}

interface Ghost {
  row: TodayRow;
  /** Where it went: another section, or null when it's off Today. */
  to: TodaySection | null;
  index: number;
}

function groupBySection(rows: TodayRow[]) {
  const by = new Map<TodaySection, TodayRow[]>();
  for (const r of rows) by.set(r.section, [...(by.get(r.section) ?? []), r]);
  return by;
}

/** A row that just left: "✓ Moved to Waiting on them", then it folds away. */
function GhostRow({ ghost: g }: { ghost: Ghost }) {
  const to = g.to ? TODAY_SECTIONS.find((s) => s.key === g.to)?.title : null;
  return (
    <li className="row-leave" aria-hidden>
      <div className="min-h-0 overflow-hidden">
        <div className="flex items-center gap-3 bg-good-soft px-4 py-3">
          <Avatar name={g.row.name} src={g.row.photoUrl} />
          <span className="text-sm font-semibold text-text">{g.row.name}</span>
          <span className="inline-flex items-center gap-1 text-sm text-good">
            <Check size={14} aria-hidden /> {to ? `Moved to ${to}` : "Done — off Today for now"}
          </span>
        </div>
      </div>
    </li>
  );
}

function SectionHeading({ title, hint, count, folded }: { title: string; hint: string; count: number; folded?: boolean }) {
  return (
    <>
      <div className="flex items-center gap-2">
        {folded !== undefined && (folded ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />)}
        <SectionTitle>{title}</SectionTitle>
        <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-semibold tabular text-text-muted ring-1 ring-inset ring-border">{count}</span>
      </div>
      <p className="mt-0.5 text-[13px] text-text-muted">{hint}</p>
    </>
  );
}

function href(r: TodayRow, section: CreatorSection) {
  return creatorSectionHref(r.partnershipId, section, "/");
}

function TodayItem({
  row: r,
  meId,
  team,
  showCampaign,
  onActed,
}: {
  row: TodayRow;
  meId: string | null;
  team: TeammateOption[];
  showCampaign: boolean;
  /** Any press in the row (its menus too — React events cross portals) marks it as acted on. */
  onActed: (id: string) => void;
}) {
  const turn = whoseTurnText(r.whoseTurn);
  const [panel, setPanelState] = useState<"log" | "archive" | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  // Closing a panel opened from ⋯ puts focus back on ⋯ (interaction review 2026-09-30).
  const setPanel = (p: "log" | "archive" | null) => {
    setPanelState(p);
    if (!p) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-more-for="${r.partnershipId}"]`)?.focus());
  };
  const owner = r.ownerId ? { id: r.ownerId, name: r.ownerName ?? "A teammate", label: team.find((t) => t.id === r.ownerId)?.label ?? "?" } : null;
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start" onClickCapture={() => onActed(r.partnershipId)}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Avatar name={r.name} src={r.photoUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={href(r, "overview")} className="text-sm font-semibold text-text hover:text-accent">
              {r.name}
            </Link>
            <OwnerMenu partnershipId={r.partnershipId} name={r.name} owner={owner} meId={meId} team={team} />
            <QuickStage partnershipId={r.partnershipId} name={r.name} stage={r.stage} asPill />
            {r.badge === "due" && <Badge tone="warn" title="The first message is overdue">Due</Badge>}
            {r.badge === "late" && <Badge tone="bad" title="The video is later than the client's Video due setting">Late</Badge>}
            {showCampaign && <Badge tone="neutral">{r.campaignName}</Badge>}
            {turn && r.section !== "your_turn" && r.section !== "waiting" && r.whoseTurn === "us" && <Badge tone="warn">Your turn</Badge>}
          </div>
          <p className="mt-1 text-sm text-text-muted">
            {r.latestFromEmail ? (
              <Mail size={12} strokeWidth={1.5} className="mr-1 inline align-[-1px] text-text-faint" />
            ) : (
              <MessageCircle size={12} strokeWidth={1.5} className="mr-1 inline align-[-1px] text-text-faint" />
            )}
            {r.latest}
            {r.latestAt && <span className="text-text-faint"> · {relativeDays(r.latestAt)}</span>}
            {r.section === "waiting" && turn && <span className="text-text-faint"> · {turn.label}</span>}
          </p>
          {r.note && <p className="mt-0.5 text-xs text-text-faint">{r.note}</p>}
          {r.stageFlag?.quote && <p className="mt-0.5 text-xs text-text-muted">&ldquo;{r.stageFlag.quote}&rdquo;</p>}
          {(r.statusNote || noteOpen) && (
            <div className="mt-1.5">
              <StatusNote partnershipId={r.partnershipId} note={r.statusNote} editing={noteOpen} onEditingChange={setNoteOpen} hideWhenEmpty />
            </div>
          )}
          {(r.section === "get_address" || r.stageFlag?.beneath === "get_address") && r.suggestedAddress && (
            <p className="mt-1 text-xs text-text-muted">
              <MapPin size={12} strokeWidth={1.5} className="mr-1 inline align-[-1px] text-text-faint" />
              Found in their email: <span className="font-medium text-text">{r.suggestedAddress}</span>
            </p>
          )}
          {r.backFromArchive && (
            <p className="mt-1 text-xs text-text-muted">
              Back from the archive — {r.backFromArchive.why === "wrote" ? "they wrote" : "the reminder date came"}
              {r.backFromArchive.reason ? ` · ${r.backFromArchive.by ? `${r.backFromArchive.by.split(" ")[0]}: ` : ""}${r.backFromArchive.reason}` : ""}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <NextAction row={r} />
            <Menu label={`More for ${r.name}`} moreFor={r.partnershipId}>
              <MenuItem icon={<CalendarClock size={14} />} onSelect={() => setPanel("log")}>
                Log a message…
              </MenuItem>
              <MenuItem icon={<NotebookPen size={14} />} onSelect={() => setNoteOpen(true)}>
                {r.statusNote ? "Edit the note" : "Add a note"}
              </MenuItem>
              <MenuItem icon={<Archive size={14} />} onSelect={() => setPanel("archive")}>
                Archive…
              </MenuItem>
            </Menu>
          </div>
          {panel === "log" && (
            <div className="mt-2">
              <LogMessagePanel partnershipId={r.partnershipId} name={r.name} hasOutbound={r.hasOutbound} onClose={() => setPanel(null)} />
            </div>
          )}
          {panel === "archive" && (
            <div className="mt-2">
              <ArchiveControl partnershipId={r.partnershipId} name={r.name} startOpen onClose={() => setPanel(null)} />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** The one button for this row's next step. */
function NextAction({ row: r }: { row: TodayRow }) {
  switch (r.section) {
    case "check_stage":
      // Move / Keep first, then the row's own next step — a flagged creator who just wrote still gets "Open conversation".
      return r.stageFlag ? (
        <>
          <StageFlagButtons partnershipId={r.partnershipId} name={r.name} stage={r.stage} suggested={r.stageFlag.suggested} />
          {r.stageFlag.beneath && r.stageFlag.beneath !== "check_stage" && <NextAction row={{ ...r, section: r.stageFlag.beneath }} />}
        </>
      ) : null;
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
    case "waiting_approval":
      return <ApprovalButtons partnershipId={r.partnershipId} name={r.name} who="agency" />;
    case "follow_up":
      return (
        <>
          <MessagedButton partnershipId={r.partnershipId} name={r.name} hasOutbound={r.hasOutbound} variant="primary" />
          <ReplyButton partnershipId={r.partnershipId} name={r.name} />
        </>
      );
    case "to_contact":
      return <MessagedButton partnershipId={r.partnershipId} name={r.name} hasOutbound={r.hasOutbound} variant="primary" />;
    case "finalizing":
      return (
        <>
          <Button size="sm" variant="primary" href={href(r, r.whoseTurn === "us" ? "conversation" : "agreement")} icon={<ArrowRight size={13} />}>
            {r.whoseTurn === "us" ? "Open conversation" : "Open Deal"}
          </Button>
          {r.whoseTurn === "us" && (
            <Button size="sm" variant="ghost" href={href(r, "agreement")}>
              Open Deal
            </Button>
          )}
        </>
      );
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
          undo: true,
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
