"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowRight, CalendarClock, Mail, MessageCircle, MoveRight, NotebookPen, X } from "lucide-react";
import { STAGES, stageHint, stageLabel, EXIT_REASONS_BY_STAGE, STAGE_GROUP_LABELS } from "@/lib/stages";
import type { CmStage } from "@/lib/db/schema";
import { relativeDays } from "@/lib/format";
import { whoseTurnText, type WhoseTurn } from "@/lib/activity";
import { Avatar, Badge, StagePill, Button, IconButton, TurnDot, cn } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import { VideoLinkPrompt, needsVideo } from "@/components/partnership-actions";
import { QuickStage } from "@/components/quick-stage";
import { OwnerMenu, type OwnerInfo, type TeammateOption } from "@/components/owner-controls";
import { StatusNote } from "@/components/status-note";
import { ArchiveControl } from "@/components/archive";
import { LogMessagePanel } from "@/components/log-message";
import { Menu, MenuItem, MenuLabel } from "@/components/menu";
import type { StatusNoteView } from "@/lib/status-note";

export interface BoardCard {
  partnershipId: string;
  name: string;
  stage: CmStage;
  campaignName: string;
  /** The latest message, as one line (the email summary when it's current). */
  latest: string;
  latestFromEmail: boolean;
  /** ISO time of the latest message; null when unknown or none. */
  latestAt: string | null;
  whoseTurn: WhoseTurn | null;
  /** Our own note on where things stand. */
  statusNote: StatusNoteView | null;
  photoUrl: string | null;
  clientApproval: "pending" | "approved" | "passed" | null;
  /** Who looks after it; null = unassigned. */
  owner: OwnerInfo | null;
  /** Anything sent yet — a logged message is then a follow-up, not the first. */
  hasOutbound: boolean;
}

// Active stages get their own column; the three terminal stages collapse into
// one "Closed" column so the board stays about live work.
const COLUMNS: { key: string; label: string; hint: string; group: string; stages: CmStage[] }[] = [
  ...STAGES.filter((s) => !s.terminal).map((s) => ({
    key: s.value,
    label: s.label,
    hint: s.hint,
    group: STAGE_GROUP_LABELS[s.group],
    stages: [s.value] as CmStage[],
  })),
  {
    key: "closed",
    label: "Closed",
    hint: "We passed, they declined, or they stopped replying.",
    group: STAGE_GROUP_LABELS.closed,
    stages: ["passed", "declined", "no_response"] as CmStage[],
  },
];

const CLOSE_OPTIONS: CmStage[] = ["passed", "declined", "no_response"];

/** A card dropped on Closed: which card, and (once chosen) who ended it. */
interface Closing {
  id: string;
  stage: CmStage | null;
}

/**
 * The board. Each card is kept to what you need at a glance (owner decision
 * 2026-09-29, "minimal"): the name and who looks after it, whose turn it is,
 * the latest message and when, and our note only if there is one. Moving,
 * logging, notes and archiving live in the card's ⋯ menu; dragging still works.
 * The campaign shows only when the sidebar is on All campaigns.
 */
export function PipelineBoard({
  cards,
  meId,
  team,
  clientName,
  showCampaign,
}: {
  cards: BoardCard[];
  meId: string | null;
  team: TeammateOption[];
  clientName: string;
  showCampaign: boolean;
}) {
  const { run, pending } = useSave();
  const [items, setItems] = useState(cards);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [closing, setClosing] = useState<Closing | null>(null);
  // A card moved to Posted with no video recorded: ask for the link on the card.
  const [posting, setPosting] = useState<string | null>(null);
  // Closed deals fold away until asked for; the board is about live work.
  const [showClosed, setShowClosed] = useState(false);

  // After a refresh the server hands down new cards; adopt them.
  const [seenCards, setSeenCards] = useState(cards);
  if (seenCards !== cards) {
    setSeenCards(cards);
    setItems(cards);
  }

  const move = async (partnershipId: string, toStage: CmStage, exitReason?: string | null, videoUrl?: string) => {
    const card = items.find((c) => c.partnershipId === partnershipId);
    if (!card || card.stage === toStage) return;
    const before = items;
    setItems((prev) => prev.map((c) => (c.partnershipId === partnershipId ? { ...c, stage: toStage } : c)));
    const r = await run(
      () =>
        api<{ stage?: CmStage }>(`/api/partnerships/${partnershipId}/stage`, {
          stage: toStage,
          exitReason: exitReason === undefined ? undefined : exitReason,
          videoUrl,
        }),
      { success: `${card.name} → ${stageLabel(toStage)}` },
    );
    if (!r.ok) {
      setItems(before);
      if (needsVideo(r.data)) setPosting(partnershipId);
      return;
    }
    setPosting(null);
    // The server can land somewhere else (Agreed continues to Ready to ship when the address is on file).
    const landed = r.data.stage;
    if (landed && landed !== toStage) {
      setItems((prev) => prev.map((c) => (c.partnershipId === partnershipId ? { ...c, stage: landed } : c)));
    }
  };

  const closePrompt = (c: Closing) => {
    const card = items.find((x) => x.partnershipId === c.id);
    return (
      <div className="rounded-lg border border-accent-ring bg-surface p-2.5 text-xs shadow-pop">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="font-medium text-text">Close {card?.name ?? "this creator"}</span>
          <IconButton label="Cancel" icon={<X size={13} />} onClick={() => setClosing(null)} />
        </div>
        {!c.stage ? (
          <>
            <div className="mb-1.5 text-text-muted">Who ended it?</div>
            <div className="flex flex-wrap gap-1">
              {CLOSE_OPTIONS.map((s) => (
                <Button key={s} size="sm" title={stageHint(s)} onClick={() => setClosing({ ...c, stage: s })}>
                  {stageLabel(s)}
                </Button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="mb-1.5 text-text-muted">{stageLabel(c.stage)} — why?</div>
            <div className="flex flex-wrap gap-1">
              {(EXIT_REASONS_BY_STAGE[c.stage] ?? []).map((r) => (
                <Button
                  key={r.value}
                  size="sm"
                  onClick={() => {
                    move(c.id, c.stage!, r.value);
                    setClosing(null);
                  }}
                >
                  {r.label}
                </Button>
              ))}
            </div>
            <button
              type="button"
              className="mt-2 text-text-faint hover:text-accent"
              onClick={() => {
                move(c.id, c.stage!, null);
                setClosing(null);
              }}
            >
              Skip the reason
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {COLUMNS.map((col) => {
        const colCards = items.filter((c) => col.stages.includes(c.stage));
        const dropStage = col.stages[0];
        // Empty stages (and Closed, until opened) fold to a slim strip so the whole
        // pipeline fits on one screen; they open while a card is being dragged.
        const folded = !dragId && !(closing && col.key === "closed") && (colCards.length === 0 || (col.key === "closed" && !showClosed));
        if (folded) {
          const isClosed = col.key === "closed" && colCards.length > 0;
          return (
            <button
              key={col.key}
              type="button"
              disabled={!isClosed}
              onClick={() => isClosed && setShowClosed(true)}
              title={isClosed ? `Show ${colCards.length} closed` : `${col.label} — nobody here. ${col.hint}`}
              aria-label={isClosed ? `Show ${colCards.length} closed` : `${col.label}: empty`}
              className={cn(
                "flex w-10 shrink-0 flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-surface-2/40 py-3 text-xs text-text-faint transition",
                isClosed && "cursor-pointer border-solid hover:border-accent-ring hover:text-accent",
              )}
            >
              <span className="rounded-full bg-surface px-1.5 text-[11px] font-semibold tabular ring-1 ring-inset ring-border">{colCards.length}</span>
              <span className="font-medium [writing-mode:vertical-rl]">{col.label}</span>
            </button>
          );
        }
        return (
          <div
            key={col.key}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(col.key);
            }}
            onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
            onDrop={() => {
              if (dragId) {
                if (col.key === "closed") setClosing({ id: dragId, stage: null });
                else move(dragId, dropStage);
              }
              setDragId(null);
              setOverCol(null);
            }}
            className={cn(
              "flex w-60 shrink-0 flex-col rounded-xl border bg-surface-2/60 transition",
              overCol === col.key ? "border-accent-ring ring-2 ring-accent-soft" : "border-border",
            )}
          >
            <div className="px-3 pt-2.5 pb-2" title={col.hint}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-text">{col.label}</span>
                <span className="rounded-full bg-surface px-1.5 text-[11px] font-semibold tabular text-text-muted ring-1 ring-inset ring-border">
                  {colCards.length}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-text-faint">
                <span>{col.group}</span>
                {col.key === "closed" && showClosed && !dragId && (
                  <Button variant="link" className="!text-[11px]" onClick={() => setShowClosed(false)}>
                    Fold away
                  </Button>
                )}
              </div>
            </div>
            <div className="flex min-h-16 flex-col gap-2 px-2 pb-2">
              {closing && col.key === "closed" && closePrompt(closing)}
              {colCards.map((c) => (
                <PipelineCard
                  key={c.partnershipId}
                  card={c}
                  closed={col.key === "closed"}
                  dragging={dragId === c.partnershipId}
                  onDragStart={() => setDragId(c.partnershipId)}
                  onDragEnd={() => setDragId(null)}
                  onMoved={(landed) => setItems((prev) => prev.map((x) => (x.partnershipId === c.partnershipId ? { ...x, stage: landed } : x)))}
                  meId={meId}
                  team={team}
                  clientName={clientName}
                  showCampaign={showCampaign}
                  videoPrompt={
                    posting === c.partnershipId ? (
                      <VideoLinkPrompt pending={pending} onSubmit={(url) => move(c.partnershipId, "posted", undefined, url)} onCancel={() => setPosting(null)} />
                    ) : null
                  }
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Marks a card's controls: a press that starts there (the owner chip, the ⋯
 * button, the note, a panel's inputs) never drags the card. The browser drags
 * the nearest draggable ancestor whatever the child says, so the card checks
 * where the press began (review 2026-09-29).
 */
const noDrag = { "data-no-drag": "" } as const;

function PipelineCard({
  card: c,
  closed,
  dragging,
  onDragStart,
  onDragEnd,
  onMoved,
  meId,
  team,
  clientName,
  showCampaign,
  videoPrompt,
}: {
  card: BoardCard;
  closed: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMoved: (landed: CmStage) => void;
  meId: string | null;
  team: TeammateOption[];
  clientName: string;
  showCampaign: boolean;
  videoPrompt: React.ReactNode;
}) {
  const router = useRouter();
  const pressedOnControl = useRef(false);
  const [panel, setPanel] = useState<"move" | "log" | "archive" | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const href = `/creators/${c.partnershipId}?returnTo=/pipeline`;
  const turn = whoseTurnText(c.whoseTurn);
  const awaitingApproval = c.clientApproval === "pending" && c.stage === "shortlisted";
  return (
    <div
      draggable
      onPointerDownCapture={(e) => {
        pressedOnControl.current = e.target instanceof Element && !!e.target.closest("[data-no-drag]");
      }}
      onDragStart={(e) => {
        if (pressedOnControl.current || (e.target instanceof Element && e.target !== e.currentTarget && !!e.target.closest("[data-no-drag]"))) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn("cursor-grab rounded-lg border border-border bg-surface p-2.5 shadow-card transition active:cursor-grabbing", dragging && "opacity-50")}
    >
      <div className="flex items-center gap-2">
        <Avatar name={c.name} size="sm" src={c.photoUrl} />
        <Link href={href} className="min-w-0 flex-1 truncate text-sm font-medium text-text hover:text-accent">
          {c.name}
        </Link>
        <span {...noDrag}>
          <OwnerMenu partnershipId={c.partnershipId} name={c.name} owner={c.owner} meId={meId} team={team} />
        </span>
        <span {...noDrag}>
          <Menu label={`More for ${c.name}`}>
            <MenuItem icon={<MoveRight size={14} />} onSelect={() => setPanel("move")}>
              Move to…
            </MenuItem>
            <MenuItem icon={<CalendarClock size={14} />} onSelect={() => setPanel("log")}>
              Log a message…
            </MenuItem>
            <MenuItem icon={<NotebookPen size={14} />} onSelect={() => setNoteOpen(true)}>
              {c.statusNote ? "Edit the note" : "Add a note"}
            </MenuItem>
            <MenuItem icon={<Archive size={14} />} onSelect={() => setPanel("archive")}>
              Archive…
            </MenuItem>
            <MenuLabel />
            <MenuItem icon={<ArrowRight size={14} />} onSelect={() => router.push(href)}>
              Open
            </MenuItem>
          </Menu>
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        {closed ? (
          <StagePill stage={c.stage} />
        ) : awaitingApproval ? (
          <TurnDot tone="warn" title="The client decides before anyone reaches out">
            Waiting on {clientName}&rsquo;s approval
          </TurnDot>
        ) : turn ? (
          <TurnDot tone={turn.tone}>{turn.label}</TurnDot>
        ) : (
          <span />
        )}
        {showCampaign && (
          <Badge tone="info" title="Campaign">
            {c.campaignName}
          </Badge>
        )}
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-text-muted" title={c.latest}>
        {c.latestFromEmail ? (
          <Mail size={11} className="mr-1 inline align-[-1px] text-text-faint" />
        ) : (
          <MessageCircle size={11} className="mr-1 inline align-[-1px] text-text-faint" />
        )}
        {c.latest}
        {c.latestAt && <span className="text-text-faint"> · {relativeDays(c.latestAt)}</span>}
      </p>
      {(c.statusNote || noteOpen) && (
        <div className="mt-1.5" {...noDrag}>
          <StatusNote partnershipId={c.partnershipId} note={c.statusNote} compact editing={noteOpen} onEditingChange={setNoteOpen} hideWhenEmpty />
        </div>
      )}
      {panel && (
        <div className="mt-2" {...noDrag}>
          {panel === "move" && (
            <div className="space-y-1.5">
              <QuickStage
                partnershipId={c.partnershipId}
                name={c.name}
                stage={c.stage}
                asMove
                className="w-full"
                onMoved={(landed) => {
                  setPanel(null);
                  onMoved(landed);
                }}
              />
              <Button variant="link" className="!text-[11px]" onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          )}
          {panel === "log" && <LogMessagePanel partnershipId={c.partnershipId} name={c.name} hasOutbound={c.hasOutbound} onClose={() => setPanel(null)} />}
          {panel === "archive" && <ArchiveControl partnershipId={c.partnershipId} name={c.name} startOpen onClose={() => setPanel(null)} />}
        </div>
      )}
      {videoPrompt && (
        <div className="mt-2" {...noDrag}>
          {videoPrompt}
        </div>
      )}
    </div>
  );
}
