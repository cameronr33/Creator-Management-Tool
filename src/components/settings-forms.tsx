"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Copy, Check, Trash2, KeyRound } from "lucide-react";

async function jsonFetch(url: string, body: unknown, method = "POST") {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export function CampaignAdder({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!name.trim()) return;
    setPending(true);
    setError(null);
    const { ok, data } = await jsonFetch("/api/campaigns", { clientId, name: name.trim() });
    setPending(false);
    if (ok) {
      setName("");
      router.refresh();
    } else {
      setError(data.error ?? "Failed");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New campaign name"
        className="w-56 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <button
        onClick={add}
        disabled={pending}
        className="flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
      >
        <Plus size={14} /> Add
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
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
  const router = useRouter();
  const [name, setName] = useState(
    template?.name ?? (channel === "email" ? "Default email outreach" : "Default outreach"),
  );
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setPending(true);
    setSaved(false);
    const { ok } = await jsonFetch("/api/templates", {
      id: template?.id,
      clientId,
      name,
      channel,
      subject: channel === "email" ? subject.trim() || null : null,
      body,
      isDefault: true,
    });
    setPending(false);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    }
  };

  return (
    <div className="space-y-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />
      {channel === "email" && (
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject — placeholders work here too"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        placeholder="Use {{name}}, {{content_descriptor}}, {{reason}} placeholders…"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-accent"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending || !body.trim()}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          Save default {channel === "email" ? "email" : "DM"} template
        </button>
        {saved && <span className="text-sm text-emerald-700">Saved</span>}
      </div>
    </div>
  );
}

export function GmailConnectCard({
  configured,
  account,
}: {
  configured: boolean;
  account: {
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
    } | null;
  } | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const syncNow = async () => {
    setPending(true);
    setResult(null);
    const res = await fetch("/api/gmail/sync", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setPending(false);
    if (res.ok) {
      setResult(
        `Synced: ${data.inserted ?? 0} new touchpoint(s), ${data.stageChanges?.length ?? 0} stage change(s), ${data.unmatched?.length ?? 0} unmatched.`,
      );
      router.refresh();
    } else {
      setResult(`Sync failed: ${data.error ?? res.statusText}`);
    }
  };

  const disconnect = async () => {
    await fetch("/api/gmail/disconnect", { method: "POST" });
    router.refresh();
  };

  if (!configured) {
    return (
      <p className="text-sm text-text-muted">
        Set <code className="text-xs">GOOGLE_CLIENT_ID</code> and{" "}
        <code className="text-xs">GOOGLE_CLIENT_SECRET</code> in the environment to enable Gmail
        sync — the README has the Google Cloud setup steps.
      </p>
    );
  }

  if (!account) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-text-muted">
          Connect the mailbox that is cc&apos;d on creator outreach. The app gets{" "}
          <strong>read-only</strong> access, matches threads to creators by business email, and
          logs touchpoints automatically — twice a day and on demand.
        </p>
        <a
          href="/api/gmail/connect"
          className="inline-block rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
        >
          Connect Gmail
        </a>
      </div>
    );
  }

  const s = account.lastSyncSummary;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium text-text">{account.email}</span>
        <span className="text-xs text-emerald-700">Connected · read-only</span>
      </div>
      <div className="text-xs text-text-muted">
        {account.lastSyncAt ? (
          <>
            Last sync {account.lastSyncAt}
            {account.lastSyncStatus === "ok" && s
              ? ` — ${s.inserted ?? 0} new, ${s.unmatched ?? 0} unmatched, ${s.stageChanges ?? 0} stage change(s)`
              : account.lastSyncStatus
                ? ` — failed: ${account.lastSyncStatus}`
                : null}
          </>
        ) : (
          "Never synced — runs automatically twice a day, or sync now."
        )}
      </div>
      {result && <p className="text-xs text-text-muted">{result}</p>}
      <div className="flex gap-2">
        <button
          onClick={syncNow}
          disabled={pending}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? "Syncing…" : "Sync now"}
        </button>
        <button
          onClick={disconnect}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-muted transition hover:bg-surface-2"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}

export function ApiKeyManager({
  keys,
}: {
  keys: { id: string; name: string; keyPrefix: string; lastUsedAt: Date | null; revokedAt: Date | null }[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setPending(true);
    const { ok, data } = await jsonFetch("/api/api-keys", { name: name.trim() });
    setPending(false);
    if (ok) {
      setNewKey(data.key);
      setName("");
      router.refresh();
    }
  };

  const revoke = async (id: string) => {
    await jsonFetch("/api/api-keys", { id }, "DELETE");
    router.refresh();
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
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="mb-1 text-xs font-semibold text-amber-800">
            Copy this key now — it won&apos;t be shown again.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-white px-2 py-1 text-xs">{newKey}</code>
            <button onClick={copy} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-accent hover:bg-accent-soft">
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name (e.g. Claude Code)"
          className="w-56 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          onClick={create}
          disabled={pending}
          className="flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          <KeyRound size={14} /> Create key
        </button>
      </div>

      {keys.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <span className="font-medium text-text">{k.name}</span>
                <span className="ml-2 text-xs text-text-faint">{k.keyPrefix}…</span>
                {k.revokedAt && <span className="ml-2 text-xs text-red-600">revoked</span>}
              </div>
              {!k.revokedAt && (
                <button onClick={() => revoke(k.id)} className="text-text-faint hover:text-red-600" title="Revoke">
                  <Trash2 size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
