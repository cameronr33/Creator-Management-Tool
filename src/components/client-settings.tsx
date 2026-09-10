"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ClientSettingRow {
  id: string;
  name: string;
  slug: string;
  hidden: boolean;
  isCurrent: boolean;
  followUpThresholds: {
    initialOutreachAfterDays?: number;
    followUp1AfterDays?: number;
    followUp2AfterDays?: number;
    markNoResponseAfterDays?: number;
  } | null;
}

export interface ThresholdDefaults {
  initialOutreachAfterDays: number;
  followUp1AfterDays: number;
  followUp2AfterDays: number;
  markNoResponseAfterDays: number;
}

async function patch(clientId: string, body: unknown) {
  const res = await fetch(`/api/clients/${clientId}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

/** Which shared-roster clients this tool shows. The roster itself is untouched. */
export function ClientVisibility({ clients }: { clients: ClientSettingRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  const toggle = async (c: ClientSettingRow) => {
    setPending(c.id);
    await patch(c.id, { hidden: !c.hidden });
    setPending(null);
    router.refresh();
  };

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {clients.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!c.hidden}
              disabled={pending === c.id || c.isCurrent}
              onChange={() => toggle(c)}
            />
            <span className={c.hidden ? "text-text-faint" : "text-text"}>{c.name}</span>
            {c.isCurrent && <span className="text-xs text-accent">current</span>}
          </label>
          <span className="text-xs text-text-faint">{c.slug}</span>
        </li>
      ))}
    </ul>
  );
}

const FIELDS: { key: keyof ThresholdDefaults; label: string }[] = [
  { key: "initialOutreachAfterDays", label: "Initial outreach due after (days shortlisted)" },
  { key: "followUp1AfterDays", label: "Follow-up 1 due after (days silent)" },
  { key: "followUp2AfterDays", label: "Follow-up 2 due after (days silent)" },
  { key: "markNoResponseAfterDays", label: "Auto-close as no response after (days silent, post FU2)" },
];

/**
 * The follow-up loop's reference values, per client. Editing these is the
 * "slower loop that owns the faster loop's target" — the cadence is a choice
 * someone can revisit, not a constant buried in code.
 */
export function FollowUpCadence({
  clientId,
  clientName,
  current,
  defaults,
}: {
  clientId: string;
  clientName: string;
  current: ClientSettingRow["followUpThresholds"];
  defaults: ThresholdDefaults;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, String(current?.[f.key] ?? defaults[f.key])])),
  );
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const save = async () => {
    setPending(true);
    setSaved(null);
    const overrides: Record<string, number> = {};
    for (const f of FIELDS) {
      const n = Number(values[f.key]);
      if (Number.isFinite(n) && n !== defaults[f.key]) overrides[f.key] = n;
    }
    const ok = await patch(clientId, {
      followUpThresholds: Object.keys(overrides).length ? overrides : null,
    });
    setPending(false);
    setSaved(ok ? "Saved" : "Failed to save");
    if (ok) router.refresh();
  };

  const reset = async () => {
    setValues(Object.fromEntries(FIELDS.map((f) => [f.key, String(defaults[f.key])])));
    setPending(true);
    await patch(clientId, { followUpThresholds: null });
    setPending(false);
    setSaved("Reset to defaults");
    router.refresh();
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-faint">Follow-up cadence for {clientName}. Blank = default.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex items-center justify-between gap-2 text-xs text-text-muted">
            <span>{f.label}</span>
            <input
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value.replace(/[^\d]/g, "") }))}
              inputMode="numeric"
              className="w-16 rounded-lg border border-border bg-surface px-2 py-1 text-right text-sm outline-none focus:border-accent"
            />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          Save cadence
        </button>
        <button onClick={reset} disabled={pending} className="text-xs text-text-faint hover:text-accent">
          Reset to defaults
        </button>
        {saved && <span className="text-xs text-emerald-700">{saved}</span>}
      </div>
    </div>
  );
}
