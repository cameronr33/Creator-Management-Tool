"use client";

import { useState } from "react";
import { Button, Field, Input, Segmented } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import { toast } from "@/components/toast";
import { LOG_MAX_PAST_DAYS } from "@/lib/log-time";

export type WhenChoice = "today" | "yesterday" | "pick";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ymdDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

/** The date "Pick a date" starts on: two days ago (Today and Yesterday have their own buttons). */
export function defaultPickedDate(): string {
  return ymdDaysAgo(2);
}

/**
 * When it happened, as the browser sees it: Today = now (nothing sent);
 * Yesterday = this time yesterday; a picked date = noon that day (now, if
 * it's today). The server refuses the future and anything over 180 days back.
 */
export function whenToIso(choice: WhenChoice, picked: string): string | undefined {
  if (choice === "today") return undefined;
  if (choice === "yesterday") return new Date(Date.now() - 86_400_000).toISOString();
  if (!picked) return undefined;
  if (picked === ymd(new Date())) return undefined;
  return new Date(`${picked}T12:00`).toISOString();
}

/**
 * Today / Yesterday / Pick a date — shared by the quick log panel and the
 * timeline form. The oldest pickable day stops one short of the server's limit
 * so noon on it is always inside.
 */
export function DateChoice({ choice, picked, onChoice, onPicked }: { choice: WhenChoice; picked: string; onChoice: (c: WhenChoice) => void; onPicked: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="When">
        <Segmented<WhenChoice>
          aria-label="When it happened"
          value={choice}
          onChange={onChoice}
          options={[
            { value: "today", label: "Today" },
            { value: "yesterday", label: "Yesterday" },
            { value: "pick", label: "Pick a date" },
          ]}
        />
      </Field>
      {choice === "pick" && (
        <Field label="Date">
          <Input compact type="date" className="w-40" value={picked} min={ymdDaysAgo(LOG_MAX_PAST_DAYS - 1)} max={ymdDaysAgo(0)} onChange={(e) => onPicked(e.target.value)} />
        </Field>
      )}
    </div>
  );
}

type How = "ig_dm" | "email" | "phone";

/**
 * "I messaged them" / "They replied" with a date or another way — a DM, an
 * email from a teammate's own inbox (one the connected mailbox can't see), or
 * a call.
 */
export function LogMessagePanel({
  partnershipId,
  name,
  direction,
  hasOutbound,
  onClose,
}: {
  partnershipId: string;
  name: string;
  direction: "outbound" | "inbound";
  hasOutbound: boolean;
  onClose: () => void;
}) {
  const { pending, run } = useSave();
  const [how, setHow] = useState<How>("ig_dm");
  const [choice, setChoice] = useState<WhenChoice>("yesterday");
  const [picked, setPicked] = useState(defaultPickedDate);
  const outbound = direction === "outbound";

  const save = async () => {
    const what = how === "ig_dm" ? "DM" : how === "email" ? "email" : "call";
    const r = await run(
      () =>
        api<{ stageSkipped?: boolean }>("/api/outreach", {
          partnershipId,
          direction,
          channel: how,
          kind: outbound ? (hasOutbound ? "follow_up" : "initial") : "reply",
          occurredAt: whenToIso(choice, picked),
        }),
      { success: outbound ? `Logged a ${what} to ${name}` : `Logged ${name}'s ${what === "call" ? "call" : "reply"}` },
    );
    if (!r.ok) return;
    if (r.data.stageSkipped) toast("The stage didn't move", { tone: "info", detail: "Someone set it by hand after that date, so an older message doesn't change it." });
    onClose();
  };

  return (
    <div className="w-full space-y-2 rounded-lg border border-border bg-surface-2/60 p-2.5">
      <Field label="How" hint={how === "email" ? "Only for email the connected mailbox can't see — it picks up the rest by itself." : undefined}>
        <Segmented<How>
          aria-label="How"
          value={how}
          onChange={setHow}
          options={[
            { value: "ig_dm", label: "DM" },
            { value: "email", label: outbound ? "Email from my own inbox" : "Email to my own inbox" },
            { value: "phone", label: "Call" },
          ]}
        />
      </Field>
      <DateChoice choice={choice} picked={picked} onChoice={setChoice} onPicked={setPicked} />
      <div className="flex gap-1.5">
        <Button size="sm" variant="primary" pending={pending} onClick={save}>
          Log it
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
