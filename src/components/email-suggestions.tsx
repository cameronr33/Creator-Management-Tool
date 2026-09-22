"use client";

import { useState } from "react";
import { Link2, EyeOff } from "lucide-react";
import { Button, Field, Select } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { api, useSave } from "@/components/use-save";
import { toast } from "@/components/toast";

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
      <p className="text-sm text-text-muted">
        No unmatched senders are currently queued. This does not confirm that every conversation has been captured.
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
    <ul className="divide-y divide-border rounded-lg border border-border">
      {suggestions.map((s) => (
        <SuggestionItem key={s.id} s={s} byClient={byClient} />
      ))}
    </ul>
  );
}

function SuggestionItem({ s, byClient }: { s: SuggestionRow; byClient: Map<string, CreatorOption[]> }) {
  const { pending, run } = useSave();
  const [creatorId, setCreatorId] = useState(s.suggestedCreatorId ?? "");

  const link = async () => {
    const r = await run(
      () => api<{ synced?: { result?: { inserted?: number } } }>(`/api/emails/suggestions/${s.id}`, { action: "link", creatorId }),
      {},
    );
    if (r.ok) {
      const n = r.data.synced?.result?.inserted;
      toast(`Linked ${s.email}`, {
        tone: "good",
        detail: n != null ? `${n} message(s) pulled onto their timeline.` : undefined,
      });
    }
  };

  const ignore = () =>
    run(() => api(`/api/emails/suggestions/${s.id}`, { action: "ignore" }), {
      success: `${s.email} marked as not a creator`,
    });

  return (
    <li className="flex flex-wrap items-end gap-3 px-3 py-4">
      <div className="min-w-0 basis-full xl:basis-auto xl:flex-1">
        <div className="break-words text-sm text-text">
          {s.displayName ? <span className="font-medium">{s.displayName} </span> : null}
          <span className="text-text-muted">{s.email}</span>
        </div>
        <div className="mt-1 break-words text-xs text-text-muted">
          {s.messageCount} message{s.messageCount === 1 ? "" : "s"}
          {s.lastSeenAt ? ` · last ${s.lastSeenAt}` : ""}
          {s.sampleSubject ? ` · “${s.sampleSubject}”` : ""}
        </div>
      </div>
      <Field label="Link to creator" className="w-full sm:w-64" hint={s.suggestedCreatorName ? `Suggested: ${s.suggestedCreatorName}. Confirm before linking.` : undefined}>
        <Select
        compact
        value={creatorId}
        onChange={(e) => setCreatorId(e.target.value)}
      >
        <option value="">{s.suggestedCreatorName ? `Suggested: ${s.suggestedCreatorName}` : "Choose the creator…"}</option>
        {[...byClient.entries()].map(([client, list]) => (
          <optgroup key={client} label={client}>
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ))}
        </Select>
      </Field>
      <Button size="sm" variant="primary" icon={<Link2 size={13} />} onClick={link} pending={pending} disabled={!creatorId}>
        Link
      </Button>
      <ConfirmButton
        label="Not a creator"
        icon={<EyeOff size={13} />}
        question="Hide this address for good?"
        confirmLabel="Yes, hide it"
        pending={pending}
        onConfirm={ignore}
      />
    </li>
  );
}
