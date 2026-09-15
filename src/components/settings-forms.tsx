"use client";

import { useState } from "react";
import { Plus, Copy, Check, Trash2, KeyRound, RefreshCw, Unplug } from "lucide-react";
import { Button, Field, Input, Textarea, Callout } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { api, useSave } from "@/components/use-save";
import { toast } from "@/components/toast";

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

export function TemplateEditor({
  clientId,
  channel,
  template,
}: {
  clientId: string;
  channel: "ig_dm" | "email";
  template: { id: string; name: string; subject: string | null; body: string; isDefault: boolean } | null;
}) {
  const { pending, run } = useSave();
  const [name, setName] = useState(
    template?.name ?? (channel === "email" ? "Default email outreach" : "Default DM outreach"),
  );
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const dirty =
    name !== (template?.name ?? "") || body !== (template?.body ?? "") || subject !== (template?.subject ?? "");

  const save = () =>
    run(
      () =>
        api("/api/templates", {
          id: template?.id,
          clientId,
          name,
          channel,
          subject: channel === "email" ? subject.trim() || null : null,
          body,
          isDefault: true,
        }),
      { success: `${channel === "email" ? "Email" : "DM"} template saved` },
    );

  return (
    <div className="space-y-3">
      <Field label="Template name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {channel === "email" && (
        <Field label="Subject line" hint="Placeholders work here too.">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Partnership with {{client}}" />
        </Field>
      )}
      <Field
        label="Message"
        hint={
          <>
            Placeholders: <code>{"{{name}}"}</code> first name · <code>{"{{content_descriptor}}"}</code> their content type ·{" "}
            <code>{"{{reason}}"}</code> the one-liner typed on the Outreach page.
          </>
        }
      >
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="font-mono text-xs" />
      </Field>
      <Button variant="primary" onClick={save} pending={pending} disabled={!body.trim() || !dirty}>
        Save template
      </Button>
    </div>
  );
}

export interface GmailAccountView {
  email: string;
  connectedAt: string;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncSummary: {
    inserted?: number;
    skipped?: number;
    unmatched?: number;
    stageChanges?: number;
    messagesFetched?: number;
    suggestionsOpen?: number;
    windowDays?: number;
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
          suggestionsOpen?: number;
        }>("/api/gmail/sync"),
      {},
    );
    if (r.ok) {
      const d = r.data;
      toast(`Synced the last ${d.windowDays ?? "?"} days`, {
        tone: "good",
        detail: `${d.messagesFetched ?? 0} matched message(s) · ${d.inserted ?? 0} new on timelines · ${
          d.stageChanges?.length ?? 0
        } stage change(s) · ${d.suggestionsOpen ?? 0} sender(s) to link`,
      });
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <div className="text-text-muted">
        <span className="font-medium text-text">{account.email}</span>
        {account.lastSyncAt ? (
          <>
            {" "}
            · last checked {account.lastSyncAt}
            {account.lastSyncStatus === "ok" && s
              ? ` — ${s.messagesFetched ?? 0} matched, ${s.inserted ?? 0} new`
              : account.lastSyncStatus && account.lastSyncStatus !== "ok"
                ? ` — ${account.lastSyncStatus}`
                : null}
          </>
        ) : (
          " · never checked yet — runs twice a day"
        )}
      </div>
      <Button size="sm" icon={<RefreshCw size={13} />} onClick={syncNow} pending={pending}>
        {pending ? "Checking…" : "Check email now"}
      </Button>
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
          Connect the mailbox that gets cc&apos;d on creator outreach. The app gets <strong>read-only</strong> access,
          files every creator email onto the right record, and moves stages when creators reply — twice a day and on
          demand. It never sends mail.
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

export function ApiKeyManager({
  keys,
}: {
  keys: { id: string; name: string; keyPrefix: string; lastUsedAt: Date | null; revokedAt: Date | null }[];
}) {
  const { pending, run } = useSave();
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    const r = await run(() => api<{ key: string }>("/api/api-keys", { name: name.trim() }), {
      success: "Key created — copy it now",
    });
    if (r.ok) {
      setNewKey(r.data.key);
      setName("");
    }
  };

  const copy = async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-3">
      {newKey && (
        <Callout
          tone="warn"
          title="Copy this key now — it won't be shown again."
          actions={
            <Button size="sm" icon={copied ? <Check size={13} /> : <Copy size={13} />} onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          }
        >
          <code className="block overflow-x-auto rounded bg-surface px-2 py-1 text-xs text-text">{newKey}</code>
        </Callout>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Key name" className="w-64" hint="What will use it, e.g. Claude Code on Cameron's laptop.">
          <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
        </Field>
        <Button icon={<KeyRound size={14} />} onClick={create} pending={pending} disabled={!name.trim()} className="mb-5">
          Create key
        </Button>
      </div>

      {keys.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-text">{k.name}</span>
                <span className="ml-2 text-xs text-text-muted">{k.keyPrefix}…</span>
                {k.revokedAt && <span className="ml-2 text-xs text-bad">revoked</span>}
                {!k.revokedAt && k.lastUsedAt && (
                  <span className="ml-2 text-xs text-text-faint">last used {new Date(k.lastUsedAt).toLocaleDateString()}</span>
                )}
              </div>
              {!k.revokedAt && (
                <ConfirmButton
                  iconOnly
                  icon={<Trash2 size={14} />}
                  label={`Revoke ${k.name}`}
                  question="Revoke this key? Anything using it stops working."
                  confirmLabel="Revoke"
                  pending={pending}
                  onConfirm={() => run(() => api("/api/api-keys", { id: k.id }, "DELETE"), { success: "Key revoked" })}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
