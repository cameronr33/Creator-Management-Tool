"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Check, ChevronRight, Send, Mail, MessageCircle, Reply } from "lucide-react";
import { Avatar } from "@/components/ui";
import { renderTemplate, firstName, igDmUrl, igProfileUrl, mailtoUrl } from "@/lib/outreach";

export interface WorklistTemplate {
  subject: string | null;
  body: string;
}

export interface WorklistEntry {
  partnershipId: string;
  name: string;
  username: string;
  detail: string;
  kind: "initial" | "follow_up";
  businessEmail: string | null;
  contentPillar: string | null;
  outreachReason: string | null;
}

export interface WorklistTemplates {
  ig_dm: WorklistTemplate | null;
  email: WorklistTemplate | null;
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
      <div className="rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center">
        <p className="text-sm font-medium text-text">Inbox zero</p>
        <p className="text-sm text-text-muted">No outreach is due right now.</p>
      </div>
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

type Channel = "ig_dm" | "email";

function WorklistItem({ entry, templates }: { entry: WorklistEntry; templates: WorklistTemplates }) {
  const router = useRouter();
  const emailAvailable = !!entry.businessEmail && !!templates.email;
  const [channel, setChannel] = useState<Channel>("ig_dm");
  const [reason, setReason] = useState(entry.outreachReason ?? "");
  const [savedReason, setSavedReason] = useState(entry.outreachReason ?? "");
  // null = follow the template; a string = the operator hand-edited the message.
  const [override, setOverride] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [replyPending, setReplyPending] = useState(false);
  const [stageNote, setStageNote] = useState<string | null>(null);

  const template = templates[channel];
  const vars = useMemo(
    () => ({
      name: firstName(entry.name),
      content_descriptor: entry.contentPillar ?? "content",
      reason,
    }),
    [entry.name, entry.contentPillar, reason],
  );
  const rendered = template ? renderTemplate(template.body, vars) : "";
  const message = override ?? rendered;
  const subject = template?.subject ? renderTemplate(template.subject, vars) : null;

  const persistReason = async () => {
    const trimmed = reason.trim();
    if (trimmed === savedReason) return;
    await fetch(`/api/partnerships/${entry.partnershipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outreachReason: trimmed || null }),
    });
    setSavedReason(trimmed);
  };

  const copyAndOpen = async () => {
    if (!message) return;
    await navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    if (channel === "ig_dm") {
      window.open(igDmUrl(entry.username), "_blank", "noopener");
    } else if (entry.businessEmail) {
      window.open(mailtoUrl(entry.businessEmail, subject, message), "_self");
    }
  };

  const markSent = async () => {
    setPending(true);
    const res = await fetch("/api/outreach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partnershipId: entry.partnershipId,
        direction: "outbound",
        channel,
        kind: entry.kind,
        body: message || undefined,
        subject: channel === "email" && subject ? subject : undefined,
      }),
    });
    setPending(false);
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data?.stageChanged) {
        setStageNote(`Stage: ${data.stageChanged.from} → ${data.stageChanged.to}`);
      }
      router.refresh();
    }
  };

  const markReplied = async () => {
    setReplyPending(true);
    const res = await fetch("/api/outreach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partnershipId: entry.partnershipId,
        direction: "inbound",
        channel,
        kind: "reply",
      }),
    });
    setReplyPending(false);
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data?.stageChanged) {
        setStageNote(`Stage: ${data.stageChanged.from} → ${data.stageChanged.to}`);
      }
      router.refresh();
    }
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
            <div className="text-xs text-text-muted">
              <a
                href={igProfileUrl(entry.username)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent"
              >
                @{entry.username}
              </a>{" "}
              · {entry.detail}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {emailAvailable && (
            <div className="flex overflow-hidden rounded-lg border border-border text-xs">
              <button
                onClick={() => { setChannel("ig_dm"); setOverride(null); }}
                className={`flex items-center gap-1 px-2 py-1 transition ${channel === "ig_dm" ? "bg-accent text-white" : "text-text-muted hover:bg-surface-2"}`}
              >
                <MessageCircle size={12} /> DM
              </button>
              <button
                onClick={() => { setChannel("email"); setOverride(null); }}
                className={`flex items-center gap-1 px-2 py-1 transition ${channel === "email" ? "bg-accent text-white" : "text-text-muted hover:bg-surface-2"}`}
              >
                <Mail size={12} /> Email
              </button>
            </div>
          )}
          <Link
            href={`/creators/${entry.partnershipId}`}
            className="flex items-center gap-0.5 text-sm text-text-muted hover:text-accent"
          >
            Open <ChevronRight size={14} />
          </Link>
        </div>
      </div>

      {template ? (
        <div className="mt-3 space-y-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={persistReason}
            placeholder='Why this creator? Fills {{reason}} — e.g. "loved your brake-swap reel"'
            className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-xs outline-none focus:border-accent"
          />
          {channel === "email" && subject && (
            <div className="text-xs text-text-muted">
              <span className="font-medium">Subject:</span> {subject}
            </div>
          )}
          <textarea
            value={message}
            onChange={(e) => setOverride(e.target.value)}
            rows={Math.min(10, Math.max(4, message.split("\n").length + 1))}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none focus:border-accent"
          />
          {override !== null && (
            <button onClick={() => setOverride(null)} className="text-xs text-text-faint hover:text-accent">
              Reset to template
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-border p-3 text-xs text-text-faint">
          No default {channel === "email" ? "email" : "DM"} template — add one in Settings.
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={copyAndOpen}
          disabled={!message}
          className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm text-text-muted transition hover:bg-surface-2 disabled:opacity-50"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : channel === "ig_dm" ? "Copy & open DM" : "Copy & open email"}
        </button>
        <button
          onClick={markSent}
          disabled={pending}
          className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          <Send size={14} />
          Mark {entry.kind === "initial" ? "sent" : "followed up"}
        </button>
        <button
          onClick={markReplied}
          disabled={replyPending}
          className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm text-text-muted transition hover:bg-surface-2 disabled:opacity-50"
          title="Log an inbound reply without opening the detail page"
        >
          <Reply size={14} /> They replied
        </button>
        {stageNote && <span className="text-xs text-emerald-700">{stageNote}</span>}
      </div>
    </li>
  );
}
