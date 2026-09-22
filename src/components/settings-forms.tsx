"use client";

import { useState } from "react";
import { Plus, RefreshCw, Unplug } from "lucide-react";
import { Button, Field, Input, Callout } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { api, useSave } from "@/components/use-save";
import { toast } from "@/components/toast";
import type { GmailHealthSummary } from "@/lib/gmail-health";

export function CampaignAdder({ clientId }: { clientId: string }) {
  const { pending, run } = useSave();
  const [name, setName] = useState("");

  const add = async () => {
    if (!name.trim()) return;
    const r = await run(() => api("/api/campaigns", { clientId, name: name.trim() }), {
      success: `Campaign "${name.trim()}" created`,
    });
    if (r.ok) setName("");
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="New campaign" className="w-64">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="e.g. Suspension"
        />
      </Field>
      <Button variant="primary" icon={<Plus size={14} />} onClick={add} pending={pending} disabled={!name.trim()}>
        Add campaign
      </Button>
    </div>
  );
}

export interface GmailAccountView {
  email: string;
  connectedAt: string;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  health: GmailHealthSummary;
  lastSyncSummary: {
    inserted?: number;
    skipped?: number;
    unmatched?: number;
    stageChanges?: number;
    messagesFetched?: number;
    windowDays?: number;
    fetchErrors?: number;
  } | null;
}

/** Day-to-day view: when the mailbox last synced, and a Sync now button. */
export function GmailSyncStatus({ account }: { account: GmailAccountView }) {
  const { pending, run } = useSave();
  const s = account.lastSyncSummary;

  const syncNow = async () => {
    const r = await run(
      () =>
        api<{
          windowDays?: number;
          messagesFetched?: number;
          inserted?: number;
          stageChanges?: unknown[];
          fetchErrors?: number;
        }>("/api/gmail/sync"),
      {},
    );
    if (r.ok) {
      const d = r.data;
      const partial = (d.fetchErrors ?? 0) > 0;
      toast(partial ? "Email check incomplete" : `Checked the last ${d.windowDays ?? "?"} days`, {
        tone: partial ? "info" : "good",
        detail: `${partial ? `${d.fetchErrors} fetch(es) skipped; some messages may be missing. ` : ""}${d.messagesFetched ?? 0} matched message(s) · ${d.inserted ?? 0} new on timelines · ${
          d.stageChanges?.length ?? 0
        } stage change(s)`,
      });
    }
  };

  return (
    <div className="space-y-3">
      <Callout tone={account.health.tone} title={account.health.label}>
        {account.health.detail}
      </Callout>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="min-w-0 text-text-muted">
          <div className="break-all font-medium text-text">{account.email}</div>
          <div className="mt-0.5 text-xs">{account.lastSyncAt ? `Last checked ${account.lastSyncAt}` : "No check recorded yet"}</div>
          {s && <div className="mt-0.5 text-xs">{s.messagesFetched ?? 0} matched · {s.inserted ?? 0} new on timelines{s.windowDays != null ? ` · ${s.windowDays}-day search window` : ""}</div>}
          {account.health.state === "error" && account.lastSyncStatus && <p className="mt-1 break-words text-xs text-bad">{account.lastSyncStatus}</p>}
        </div>
        <Button size="sm" icon={<RefreshCw size={13} />} onClick={syncNow} pending={pending}>
          {pending ? "Checking…" : "Check email now"}
        </Button>
      </div>
    </div>
  );
}

/** Admin view: connect / disconnect the mailbox. */
export function GmailConnectCard({
  configured,
  account,
}: {
  configured: boolean;
  account: GmailAccountView | null;
}) {
  const { pending, run } = useSave();

  if (!configured) {
    return (
      <Callout tone="info">
        Email tracking needs Google credentials on the server (<code className="text-xs">GOOGLE_CLIENT_ID</code> and{" "}
        <code className="text-xs">GOOGLE_CLIENT_SECRET</code>). The README has the one-time Google Cloud steps.
      </Callout>
    );
  }

  if (!account) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          Connect the mailbox your team emails creators from, or keeps on cc. The app gets <strong>read-only</strong> access and
          only searches for the email addresses saved on creators — nothing else in the mailbox is read or stored. It never sends mail.
        </p>
        <Button variant="primary" href="/api/gmail/connect">
          Connect Gmail
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <div>
        <span className="font-medium text-text">{account.email}</span>
        <span className="text-text-muted"> · connected {account.connectedAt} · read-only</span>
      </div>
      <ConfirmButton
        label="Disconnect"
        icon={<Unplug size={13} />}
        question="Stop tracking email?"
        confirmLabel="Disconnect"
        pending={pending}
        onConfirm={() => run(() => api("/api/gmail/disconnect"), { success: "Gmail disconnected" })}
      />
    </div>
  );
}
