"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Reply, ChevronDown, ChevronUp, XCircle } from "lucide-react";
import { Avatar, Button, Callout, EmptyState } from "@/components/ui";
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
        <WorklistItem key={e.partnershipId} entry={e} templates={templates} />
      ))}
    </ul>
  );
}

function WorklistItem({ entry, templates }: { entry: WorklistEntry; templates: WorklistTemplates }) {
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
            <Link href={`/creators/${entry.partnershipId}`} className="font-medium text-text hover:text-accent">
              {entry.name}
            </Link>
            <div className="text-xs text-text-muted">{entry.detail}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={markReplied}
            pending={pending}
            icon={<Reply size={13} />}
            title="They answered — log the reply without opening the record"
          >
            They replied
          </Button>
          <Button size="sm" variant="ghost" href={`/creators/${entry.partnershipId}`} icon={<ChevronRight size={14} />}>
            Open record
          </Button>
        </div>
      </div>

      {entry.migrated && (
        <Callout
          tone="warn"
          className="mt-3"
          actions={
            <Button size="sm" variant="ghost" icon={<XCircle size={13} />} onClick={closeNoResponse} pending={pending}>
              Close as no response
            </Button>
          }
        >
          Imported from the old spreadsheet — the last contact date isn&apos;t known. If you&apos;re still waiting, send a
          follow-up below; if they never answered, close them.
        </Callout>
      )}

      <div className="mt-3">
        <MessageComposer target={entry} templates={templates} kind={entry.kind} />
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
      <button
        type="button"
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
      </button>
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
