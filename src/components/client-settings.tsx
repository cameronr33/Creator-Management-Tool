"use client";

import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { api, useSave } from "@/components/use-save";

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

/** Which shared-roster clients this tool shows. The roster itself is untouched. */
export function ClientVisibility({ clients }: { clients: ClientSettingRow[] }) {
  const { pending, run } = useSave();
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (c: ClientSettingRow) => {
    setBusy(c.id);
    await run(() => api(`/api/clients/${c.id}/settings`, { hidden: !c.hidden }, "PATCH"), {
      success: c.hidden ? `${c.name} is now shown` : `${c.name} hidden from this tool`,
    });
    setBusy(null);
  };

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {clients.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!c.hidden}
              disabled={(pending && busy === c.id) || c.isCurrent}
              onChange={() => toggle(c)}
              className="h-4 w-4 accent-accent"
            />
            <span className={c.hidden ? "text-text-muted" : "text-text"}>{c.name}</span>
            {c.isCurrent && <span className="text-xs text-accent">current — can&apos;t hide</span>}
          </label>
          <span className="text-xs text-text-faint">{c.slug}</span>
        </li>
      ))}
    </ul>
  );
}

const FIELDS: { key: keyof ThresholdDefaults; label: string; hint: string }[] = [
  { key: "initialOutreachAfterDays", label: "First message due", hint: "days after shortlisting with nothing sent" },
  { key: "followUp1AfterDays", label: "Follow-up 1 due", hint: "days of silence after the first message" },
  { key: "followUp2AfterDays", label: "Follow-up 2 due", hint: "days of silence after follow-up 1" },
  { key: "markNoResponseAfterDays", label: "Review unanswered outreach", hint: "days after follow-up 2 before a teammate reviews whether to close" },
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
  const { pending, run } = useSave();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, String(current?.[f.key] ?? defaults[f.key])])),
  );

  const save = async () => {
    const overrides: Record<string, number> = {};
    for (const f of FIELDS) {
      // An emptied box means "use the default", never zero days.
      const raw = values[f.key];
      if (raw === "") continue;
      const n = Number(raw);
      if (Number.isFinite(n) && n !== defaults[f.key]) overrides[f.key] = n;
    }
    const r = await run(
      () =>
        api(`/api/clients/${clientId}/settings`, {
          followUpThresholds: Object.keys(overrides).length ? overrides : null,
        }, "PATCH"),
      { success: `Follow-up cadence saved for ${clientName}` },
    );
    if (r.ok) {
      setValues(Object.fromEntries(FIELDS.map((f) => [f.key, String(overrides[f.key] ?? defaults[f.key])])));
    }
  };

  const reset = async () => {
    const r = await run(() => api(`/api/clients/${clientId}/settings`, { followUpThresholds: null }, "PATCH"), {
      success: "Cadence reset to the defaults",
    });
    if (r.ok) setValues(Object.fromEntries(FIELDS.map((f) => [f.key, String(defaults[f.key])])));
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={`${f.hint} (default ${defaults[f.key]})`}>
            <Input
              compact
              className="w-24"
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value.replace(/[^\d]/g, "") }))}
              inputMode="numeric"
            />
          </Field>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={save} pending={pending}>
          Save follow-up timing
        </Button>
        <Button variant="ghost" size="sm" onClick={reset} disabled={pending}>
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
