"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Reply, ChevronDown, ChevronUp, XCircle } from "lucide-react";
import { Avatar, Badge, Button, Callout, EmptyState } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { api, useSave } from "@/components/use-save";
import { MessageComposer, type ComposerTemplates } from "@/components/message-composer";
import { relativeDays } from "@/lib/format";

export type WorklistTemplates = ComposerTemplates;

export interface WorklistEntry {
  partnershipId: string;
  name: string;
  username: string;
  detail: string;
  kind: "initial" | "follow_up";
  businessEmail: string | null;
  contentPillar: string | null;
  outreachReason: string | null;
  /** Imported sheet row — the real last-contact date is unknown. */
  migrated?: boolean;
}

export interface AwaitingReplyEntry {
  partnershipId: string;
  name: string;
  username: string;
  lastOutboundAt: Date | string | null;
}

export function OutreachWorklist({
  entries,
  templates,
}: {
  entries: WorklistEntry[];
  templates: WorklistTemplates;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (entries.length === 0) {
    return (
      <EmptyState
        title="Nothing due right now"
        hint="Creators appear here when a first message or a follow-up comes due. Check the pipeline for who's next, or come back tomorrow."
        action={<Button href="/pipeline">Open the pipeline</Button>}
      />
    );
  }
  return (
    <ul className="space-y-3">
      {entries.map((e) => (
        <WorklistItem
          key={e.partnershipId}
          entry={e}
          templates={templates}
          expanded={expandedId === e.partnershipId}
          onToggle={() => setExpandedId((current) => current === e.partnershipId ? null : e.partnershipId)}
          onLogged={() => setExpandedId(null)}
        />
      ))}
    </ul>
  );
}

function WorklistItem({ entry, templates, expanded, onToggle, onLogged }: {
  entry: WorklistEntry;
  templates: WorklistTemplates;
  expanded: boolean;
  onToggle: () => void;
  onLogged: () => void;
}) {
  const { pending, run } = useSave();

  const markReplied = () =>
    run(
      () =>
        api("/api/outreach", {
          partnershipId: entry.partnershipId,
          direction: "inbound",
          channel: "ig_dm",
          kind: "reply",
        }),
      { success: `${entry.name} marked as replied` },
    );

  const closeNoResponse = () =>
    run(
      () =>
        api(`/api/partnerships/${entry.partnershipId}/stage`, { stage: "no_response", exitReason: "went_dark" }),
      { success: `${entry.name} closed — no response` },
    );

  return (
    <li
      id={`p-${entry.partnershipId}`}
      className="scroll-mt-4 rounded-xl border border-border bg-surface p-4 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar name={entry.name} />
          <div className="min-w-0">
            <Link href={`/creators/${entry.partnershipId}?tab=conversation#conversation`} className="font-medium text-text hover:text-accent">
              {entry.name}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2"><Badge tone={entry.kind === "initial" ? "accent" : "warn"}>{entry.kind === "initial" ? "First message" : "Follow-up"}</Badge><span className="text-xs text-text-muted">{entry.detail}</span></div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={expanded ? "secondary" : "primary"} onClick={onToggle} aria-expanded={expanded} aria-controls={`draft-${entry.partnershipId}`} icon={expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}>
            {expanded ? "Close draft" : "Write message"}
          </Button>
          <Button
            size="sm"
            onClick={markReplied}
            pending={pending}
            icon={<Reply size={13} />}
            title="They answered — log the reply without opening the record"
          >
            They replied
          </Button>
          <Button size="sm" variant="ghost" href={`/creators/${entry.partnershipId}?tab=conversation#conversation`} icon={<ChevronRight size={14} />}>
            Open record
          </Button>
        </div>
      </div>

      {expanded && entry.migrated && (
        <Callout
          tone="warn"
          className="mt-3"
          actions={
            <ConfirmButton label="Close as no response" question="Close this partnership?" confirmLabel="Close" icon={<XCircle size={13} />} onConfirm={closeNoResponse} pending={pending} />
          }
        >
          Imported from the old spreadsheet — the last contact date isn&apos;t known. If you&apos;re still waiting, send a
          follow-up below; if they never answered, close them.
        </Callout>
      )}

      <div id={`draft-${entry.partnershipId}`} hidden={!expanded} className="mt-4 border-t border-border pt-4">
        <MessageComposer target={entry} templates={templates} kind={entry.kind} onLogged={onLogged} />
      </div>
    </li>
  );
}

/**
 * Creators messaged recently and not yet due for a follow-up. Replies mostly
 * arrive in this window, so "They replied" has to be reachable here — not
 * only after the follow-up clock runs out.
 */
export function AwaitingReplyList({ entries }: { entries: AwaitingReplyEntry[] }) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-surface shadow-card">
      <Button
        variant="ghost"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm"
        aria-expanded={open}
      >
        <span className="font-medium text-text">
          Waiting on a reply <span className="text-text-muted">· {entries.length}</span>
        </span>
        <span className="flex items-center gap-1 text-xs text-text-muted">
          {open ? "Hide" : "Show"} {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </Button>
      {open && (
        <ul className="divide-y divide-border border-t border-border">
          {entries.map((e) => (
            <AwaitingReplyRow key={e.partnershipId} entry={e} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AwaitingReplyRow({ entry }: { entry: AwaitingReplyEntry }) {
  const { pending, run } = useSave();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar name={entry.name} size="sm" />
        <div className="min-w-0">
          <Link href={`/creators/${entry.partnershipId}`} className="text-sm font-medium text-text hover:text-accent">
            {entry.name}
          </Link>
          <div className="text-xs text-text-muted">
            @{entry.username} · messaged {relativeDays(entry.lastOutboundAt)}
          </div>
        </div>
      </div>
      <Button
        size="sm"
        icon={<Reply size={13} />}
        pending={pending}
        onClick={() =>
          run(
            () =>
              api("/api/outreach", {
                partnershipId: entry.partnershipId,
                direction: "inbound",
                channel: "ig_dm",
                kind: "reply",
              }),
            { success: `${entry.name} marked as replied` },
          )
        }
      >
        They replied
      </Button>
    </li>
  );
}
