"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { Button, Field, FieldGroup, Input, Segmented } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import { toast } from "@/components/toast";

/**
 * Archive (owner, 2026-09-29 — it replaces Snooze): put a creator you're no
 * longer really talking to out of Today, the Pipeline and the Creators list.
 * Optionally "remind me on" a date. They come back by themselves if they
 * write or their stage changes; Creators → Archived shows them all.
 */

/** Local midnight `n` days from today — "in 1 month" means the start of that day where the teammate is. */
function startOfDay(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

const noSubscribe = () => () => {};

/** A date in the teammate's own time zone — rendered in the browser only, since the day was picked there. */
function useLocalDateLabel(iso: string | null): string {
  return useSyncExternalStore(noSubscribe, () => (iso ? dayLabel(iso) : ""), () => "");
}

type Remind = "never" | "1m" | "3m" | "pick";

async function restore(partnershipId: string) {
  return api(`/api/partnerships/${partnershipId}/archive`, { archived: false }).catch(() => null);
}

export function ArchiveControl({
  partnershipId,
  name,
  label = "Archive",
  startOpen = false,
  onClose,
}: {
  partnershipId: string;
  name: string;
  label?: string;
  /** Opened from a ⋯ menu: the panel shows at once, and closing it hands back to the menu. */
  startOpen?: boolean;
  onClose?: () => void;
}) {
  const { pending, run } = useSave();
  const router = useRouter();
  const [open, setOpenOwn] = useState(startOpen);
  const setOpen = (v: boolean) => {
    setOpenOwn(v);
    if (!v) onClose?.();
  };
  const [remind, setRemind] = useState<Remind>("never");
  const [picked, setPicked] = useState(ymd(startOfDay(30)));
  const [why, setWhy] = useState("");
  // Open: focus lands on the first choice; Escape closes (interaction review 2026-09-30).
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('[aria-pressed="true"], input, button')?.focus();
  }, [open]);

  const [noDate, setNoDate] = useState(false);
  const save = async () => {
    if (remind === "pick" && !picked) return setNoDate(true);
    const until = remind === "1m" ? startOfDay(30) : remind === "3m" ? startOfDay(91) : remind === "pick" ? new Date(`${picked}T00:00`) : null;
    const r = await run(() => api(`/api/partnerships/${partnershipId}/archive`, { archived: true, until: until?.toISOString() ?? null, reason: why.trim() || null }));
    if (!r.ok) return;
    setOpen(false);
    setWhy("");
    toast(`${name} archived${until ? ` — back ${dayLabel(until.toISOString())}` : ""}`, {
      tone: "good",
      detail: "Off Today, the Pipeline and the Creators list. They come back if they write.",
      durationMs: 10_000,
      action: {
        label: "Undo",
        onClick: async () => {
          const u = await restore(partnershipId);
          if (u?.ok) toast(`${name} is back`, { tone: "good" });
          else toast(u?.data.error ?? "Couldn't undo it — use Restore under Creators → Archived", { tone: "bad" });
          router.refresh();
        },
      },
    });
  };

  if (!open) {
    return (
      <Button size="sm" variant="ghost" icon={<Archive size={13} />} onClick={() => setOpen(true)} title="Put them away — they come back if they write">
        {label}
      </Button>
    );
  }
  return (
    <div
      ref={panelRef}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
        }
      }}
      className="w-full space-y-2 rounded-lg border border-border bg-surface-2/60 p-2.5"
    >
      <FieldGroup label="Remind me">
        <Segmented<Remind>
          aria-label="Remind me"
          value={remind}
          onChange={setRemind}
          options={[
            { value: "never", label: "No" },
            { value: "1m", label: "In a month" },
            { value: "3m", label: "In 3 months" },
            { value: "pick", label: "On a date" },
          ]}
        />
      </FieldGroup>
      {remind === "pick" && (
        <Field label="On" error={noDate ? "Pick the day to be reminded." : undefined}>
          <Input
            compact
            type="date"
            className="w-44"
            value={picked}
            min={ymd(startOfDay(1))}
            max={ymd(startOfDay(365))}
            onChange={(e) => {
              setPicked(e.target.value);
              setNoDate(false);
            }}
          />
        </Field>
      )}
      <Field label="Why (optional)">
        <Input compact maxLength={200} value={why} placeholder="e.g. waiting for HELLA's next launch" onChange={(e) => setWhy(e.target.value)} />
      </Field>
      <div className="flex gap-1.5">
        <Button size="sm" variant="primary" icon={<Archive size={13} />} pending={pending} onClick={save}>
          Archive
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Back on Today, the Pipeline and the Creators list now. */
export function RestoreButton({ partnershipId, name }: { partnershipId: string; name: string }) {
  const { pending, run } = useSave();
  return (
    <Button size="sm" icon={<ArchiveRestore size={13} />} pending={pending} onClick={() => run(() => api(`/api/partnerships/${partnershipId}/archive`, { archived: false }), { success: `${name} is back` })}>
      Restore
    </Button>
  );
}

/** "Archived · reminder Fri, Oct 3 · Kieran: waiting for HELLA's next launch" */
export function ArchiveLine({ until, by, reason }: { until: string | null; by: string | null; reason: string | null }) {
  const day = useLocalDateLabel(until);
  return (
    <span>
      Archived
      {until ? ` · reminder ${day}` : ""}
      {by || reason ? " · " : ""}
      {by ? by.split(" ")[0] : ""}
      {by && reason ? ": " : ""}
      {reason ?? ""}
    </span>
  );
}
