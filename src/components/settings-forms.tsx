"use client";

import { useState } from "react";
import { Plus, RefreshCw, Unplug } from "lucide-react";
import { Button, Field, Input, Textarea, Callout } from "@/components/ui";
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
    fetchErrors?: number;
    truncated?: boolean;
    rosterSize?: number;
    backfilled?: number;
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
          rosterSize?: number;
          backfilled?: number;
          inserted?: number;
          stageChanges?: unknown[];
          fetchErrors?: number;
          truncated?: boolean;
        }>("/api/gmail/sync"),
      {},
    );
    if (r.ok) {
      const d = r.data;
      const partial = (d.fetchErrors ?? 0) > 0 || !!d.truncated;
      toast(partial ? "Email check incomplete — the next check continues" : "Email checked", {
        tone: partial ? "info" : "good",
        detail: `${d.rosterSize ?? 0} creator address(es) · ${d.inserted ?? 0} new message(s) · ${d.stageChanges?.length ?? 0} stage change(s)${
          d.backfilled ? ` · searched the last 6 months for ${d.backfilled} new address(es)` : ""
        }`,
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
          {s && <div className="mt-0.5 text-xs">{s.rosterSize ?? 0} creator address(es) searched · {s.inserted ?? 0} new message(s) last time</div>}
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

/**
 * "Our side": people who email creators for us from addresses the app can't
 * guess — a partner agency, a teammate's own domain. Their messages count as
 * ours, never as the creator replying. Client staff go on the client's team
 * instead (their messages count as the client's, not ours).
 */
export function TeamAddressesEditor({ entries }: { entries: string[] }) {
  const { pending, run } = useSave();
  const [text, setText] = useState(entries.join("\n"));
  const list = text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const dirty = list.join("\n") !== entries.join("\n");
  return (
    <div className="space-y-2">
      <Field
        label="Our side — other addresses that email creators for us"
        hint="One per line. An address (sam@partner-agency.com) or a whole domain (@partner-agency.com). Your mailbox's own domain and everyone who signs in here already count. People at a client go under that client's team instead."
      >
        <Textarea compact rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={"@partner-agency.com\nsam@freelance-studio.com"} />
      </Field>
      <Button
        size="sm"
        variant="primary"
        pending={pending}
        disabled={!dirty}
        onClick={() => run(() => api("/api/gmail/team", { entries: list }, "PUT"), { success: "Saved — stored emails are being re-checked" })}
      >
        Save
      </Button>
    </div>
  );
}

/**
 * Settings → Campaigns: rename, or delete (the campaign and everyone's row in
 * it; creators in no other campaign are removed completely — the confirm
 * says how many).
 */
export function CampaignManager({ campaigns }: { campaigns: { id: string; name: string; creators: number }[] }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {campaigns.map((c) => (
        <CampaignRow key={c.id} campaign={c} />
      ))}
    </ul>
  );
}

function CampaignRow({ campaign }: { campaign: { id: string; name: string; creators: number } }) {
  const { pending, run } = useSave();
  const [name, setName] = useState(campaign.name);
  const dirty = name.trim() !== campaign.name && name.trim() !== "";
  return (
    <li className="flex flex-wrap items-end gap-2 px-3 py-2.5">
      <Field label={`${campaign.creators} creator${campaign.creators === 1 ? "" : "s"}`} className="min-w-56 flex-1">
        <Input compact value={name} onChange={(e) => setName(e.target.value)} aria-label={`Rename ${campaign.name}`} />
      </Field>
      {dirty && (
        <Button
          size="sm"
          variant="primary"
          pending={pending}
          onClick={() => run(() => api(`/api/campaigns/${campaign.id}`, { name: name.trim() }, "PATCH"), { success: "Campaign renamed" })}
        >
          Rename
        </Button>
      )}
      <ConfirmButton
        label="Delete"
        icon={<Unplug size={13} />}
        question={
          campaign.creators
            ? `Delete ${campaign.name} and its ${campaign.creators} creator row${campaign.creators === 1 ? "" : "s"}? Creators in no other campaign are removed completely. This can't be undone.`
            : `Delete ${campaign.name}?`
        }
        confirmLabel="Delete"
        pending={pending}
        onConfirm={() => run(() => api(`/api/campaigns/${campaign.id}`, undefined, "DELETE"), { success: `${campaign.name} deleted` })}
      />
    </li>
  );
}
