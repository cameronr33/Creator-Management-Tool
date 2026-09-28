"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock } from "lucide-react";
import { Button, Field, Input, Segmented } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import { toast } from "@/components/toast";

/** Local midnight `n` days from today — "3 days" means the start of that day where the teammate is. */
function startOfDay(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function snoozeDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

type Choice = "3d" | "1w" | "pick";

/**
 * Snooze a creator off Today until a date, with an optional reason ("back
 * from SEMA on the 10th"). They come back on the day — or sooner, if they
 * write or their stage changes. The toast offers Undo.
 */
export function SnoozeControl({ partnershipId, name, label = "Snooze" }: { partnershipId: string; name: string; label?: string }) {
  const { pending, run } = useSave();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice>("3d");
  const [picked, setPicked] = useState(ymd(startOfDay(7)));
  const [why, setWhy] = useState("");

  const save = async () => {
    const until = choice === "3d" ? startOfDay(3) : choice === "1w" ? startOfDay(7) : new Date(`${picked}T00:00`);
    const r = await run(() => api<{ until?: string }>(`/api/partnerships/${partnershipId}/snooze`, { until: until.toISOString(), reason: why.trim() || null }));
    if (!r.ok) return;
    setOpen(false);
    setWhy("");
    toast(`${name} snoozed until ${snoozeDateLabel(r.data.until ?? until.toISOString())}`, {
      tone: "good",
      action: {
        label: "Undo",
        onClick: async () => {
          await api(`/api/partnerships/${partnershipId}/snooze`, { until: null });
          router.refresh();
        },
      },
    });
  };

  if (!open) {
    return (
      <Button size="sm" variant="ghost" icon={<AlarmClock size={13} />} onClick={() => setOpen(true)} title="Hide from Today until a date — they come back sooner if they write">
        {label}
      </Button>
    );
  }
  return (
    <div className="w-full space-y-2 rounded-lg border border-border bg-surface-2/60 p-2.5">
      <Segmented<Choice>
        aria-label="Snooze for how long"
        value={choice}
        onChange={setChoice}
        options={[
          { value: "3d", label: "3 days" },
          { value: "1w", label: "1 week" },
          { value: "pick", label: "Pick a date" },
        ]}
      />
      {choice === "pick" && (
        <Field label="Back on">
          <Input compact type="date" className="w-44" value={picked} min={ymd(startOfDay(1))} max={ymd(startOfDay(180))} onChange={(e) => setPicked(e.target.value)} />
        </Field>
      )}
      <Field label="Why (optional)">
        <Input compact maxLength={200} value={why} placeholder="e.g. back from SEMA on the 10th" onChange={(e) => setWhy(e.target.value)} />
      </Field>
      <div className="flex gap-1.5">
        <Button size="sm" variant="primary" pending={pending} onClick={save}>
          Snooze
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Bring a snoozed creator back to Today now. */
export function BringBackButton({ partnershipId, name }: { partnershipId: string; name: string }) {
  const { pending, run } = useSave();
  return (
    <Button size="sm" pending={pending} onClick={() => run(() => api(`/api/partnerships/${partnershipId}/snooze`, { until: null }), { success: `${name} is back on Today` })}>
      Bring back now
    </Button>
  );
}

/** "Back Fri, Oct 3 · Kieran: back from SEMA on the 10th" */
export function SnoozeLine({ until, by, reason }: { until: string; by: string | null; reason: string | null }) {
  // The date is shown in the teammate's own time zone; the server's first render may differ by a day at the edges.
  return (
    <span suppressHydrationWarning>
      Back {snoozeDateLabel(until)}
      {by || reason ? " · " : ""}
      {by ? by.split(" ")[0] : ""}
      {by && reason ? ": " : ""}
      {reason ?? ""}
    </span>
  );
}
