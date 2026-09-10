"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, EyeOff, Loader2 } from "lucide-react";

export interface SuggestionRow {
  id: string;
  email: string;
  displayName: string | null;
  messageCount: number;
  lastSeenAt: string | null;
  sampleSubject: string | null;
  suggestedCreatorId: string | null;
  suggestedCreatorName: string | null;
}

export interface CreatorOption {
  id: string;
  name: string;
  clientName: string;
}

/**
 * Addresses seen on cc'd outreach threads that match no creator. Each link
 * writes a cm_creator_emails row and immediately pulls that creator's
 * threads, so the payoff is visible right away.
 */
export function EmailSuggestions({
  suggestions,
  creators,
}: {
  suggestions: SuggestionRow[];
  creators: CreatorOption[];
}) {
  if (suggestions.length === 0) {
    return (
      <p className="text-xs text-text-faint">
        No unmatched senders — every address on cc&apos;d threads is linked to a creator (or ignored).
      </p>
    );
  }

  const byClient = new Map<string, CreatorOption[]>();
  for (const c of creators) {
    const list = byClient.get(c.clientName) ?? [];
    list.push(c);
    byClient.set(c.clientName, list);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-muted">
        <strong>{suggestions.length} unmatched sender(s)</strong> on cc&apos;d threads. Link each to
        its creator so their conversations start syncing — or ignore addresses that aren&apos;t
        creators (vendors, clients, tools).
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {suggestions.map((s) => (
          <SuggestionItem key={s.id} s={s} byClient={byClient} />
        ))}
      </ul>
    </div>
  );
}

function SuggestionItem({ s, byClient }: { s: SuggestionRow; byClient: Map<string, CreatorOption[]> }) {
  const router = useRouter();
  const [creatorId, setCreatorId] = useState(s.suggestedCreatorId ?? "");
  const [pending, setPending] = useState<"link" | "ignore" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const act = async (action: "link" | "ignore") => {
    setPending(action);
    setNote(null);
    const res = await fetch(`/api/emails/suggestions/${s.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "link" ? { action, creatorId } : { action }),
    });
    const data = await res.json().catch(() => ({}));
    setPending(null);
    if (!res.ok) {
      setNote(data?.error ?? "Failed");
      return;
    }
    if (action === "link") {
      const n = data?.synced?.result?.inserted;
      setNote(n != null ? `Linked — pulled ${n} touchpoint(s).` : "Linked.");
    }
    router.refresh();
  };

  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-text">
          {s.displayName ? <span className="font-medium">{s.displayName} </span> : null}
          <span className="text-text-muted">{s.email}</span>
        </div>
        <div className="truncate text-xs text-text-faint">
          {s.messageCount} message{s.messageCount === 1 ? "" : "s"}
          {s.lastSeenAt ? ` · last ${s.lastSeenAt}` : ""}
          {s.sampleSubject ? ` · “${s.sampleSubject}”` : ""}
        </div>
        {note && <div className="text-xs text-emerald-700">{note}</div>}
      </div>
      <select
        value={creatorId}
        onChange={(e) => setCreatorId(e.target.value)}
        className="max-w-[14rem] rounded-lg border border-border bg-surface px-2 py-1 text-xs"
      >
        <option value="">
          {s.suggestedCreatorName ? `Suggested: ${s.suggestedCreatorName}` : "Choose creator…"}
        </option>
        {[...byClient.entries()].map(([client, list]) => (
          <optgroup key={client} label={client}>
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        onClick={() => act("link")}
        disabled={!creatorId || pending !== null}
        className="flex items-center gap-1 rounded-lg bg-accent px-2 py-1 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
      >
        {pending === "link" ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />} Link
      </button>
      <button
        onClick={() => act("ignore")}
        disabled={pending !== null}
        className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-text-muted transition hover:bg-surface-2 disabled:opacity-50"
      >
        <EyeOff size={12} /> Ignore
      </button>
    </li>
  );
}
