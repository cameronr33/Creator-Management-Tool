"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Check, ChevronRight } from "lucide-react";
import { Avatar } from "@/components/ui";

export interface WorklistEntry {
  partnershipId: string;
  name: string;
  username: string;
  detail: string;
  message: string | null;
  kind: "initial" | "follow_up";
}

export function OutreachWorklist({ entries }: { entries: WorklistEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center">
        <p className="text-sm font-medium text-text">Inbox zero</p>
        <p className="text-sm text-text-muted">No outreach is due right now.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {entries.map((e) => (
        <WorklistItem key={e.partnershipId} entry={e} />
      ))}
    </ul>
  );
}

function WorklistItem({ entry }: { entry: WorklistEntry }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);

  const copy = async () => {
    if (!entry.message) return;
    await navigator.clipboard.writeText(entry.message);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const markSent = async () => {
    setPending(true);
    const res = await fetch("/api/outreach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partnershipId: entry.partnershipId,
        direction: "outbound",
        channel: "ig_dm",
        kind: entry.kind,
        body: entry.message ?? undefined,
      }),
    });
    setPending(false);
    if (res.ok) router.refresh();
  };

  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Avatar name={entry.name} />
          <div>
            <Link href={`/creators/${entry.partnershipId}`} className="font-medium text-text hover:text-accent">
              {entry.name}
            </Link>
            <div className="text-xs text-text-muted">@{entry.username} · {entry.detail}</div>
          </div>
        </div>
        <Link
          href={`/creators/${entry.partnershipId}`}
          className="flex items-center gap-0.5 text-sm text-text-muted hover:text-accent"
        >
          Open <ChevronRight size={14} />
        </Link>
      </div>

      {entry.message && (
        <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3">
          <p className="whitespace-pre-wrap text-sm text-text-muted">{entry.message}</p>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={copy}
          disabled={!entry.message}
          className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm text-text-muted transition hover:bg-surface-2 disabled:opacity-50"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy message"}
        </button>
        <button
          onClick={markSent}
          disabled={pending}
          className="rounded-lg bg-accent px-2.5 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          Mark {entry.kind === "initial" ? "sent" : "followed up"}
        </button>
      </div>
    </li>
  );
}
