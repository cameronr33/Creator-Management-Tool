"use client";

import { useState } from "react";
import { Plus, ChevronDown, ChevronUp, Send as SendIcon } from "lucide-react";
import {
  stagesByGroup,
  stageHint,
  stageLabel,
  isTerminal,
  EXIT_REASONS_BY_STAGE,
} from "@/lib/stages";
import type { CmStage, CmShipment } from "@/lib/db/schema";
import { Button, Field, FieldGroup, Input, Select, Textarea, Segmented } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import { toast } from "@/components/toast";
import { DateChoice, defaultPickedDate, whenToIso, type WhenChoice } from "@/components/log-message";

/* ── Stage ────────────────────────────────────────────────────── */

/** True when the stage API refused a Posted move because no video is recorded yet. */
export function needsVideo(data: unknown): boolean {
  const d = data as { details?: { needsVideo?: boolean } } | null;
  return !!d?.details?.needsVideo;
}

/**
 * Posted always has a video behind it. When someone moves a creator to
 * Posted and none is recorded, this asks for the link right there.
 */
export function VideoLinkPrompt({
  pending,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  onSubmit: (url: string) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  return (
    <div className="space-y-2 rounded-lg border border-info-line bg-accent-soft p-2.5 text-xs">
      <Field label="Link to the posted video" hint="Posted needs the video itself. Paste its link.">
        <Input compact autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.instagram.com/reel/…" />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" pending={pending} disabled={!url.trim()} onClick={() => onSubmit(url.trim())}>
          Save and mark Posted
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * The stage control. Grouped by phase, explains the current stage under it,
 * says what will move it automatically, and — when a closed stage is picked —
 * asks who ended it and why before saving, so the reason is never lost.
 */
export function StageControl({
  partnershipId,
  stage,
  exitReason,
  autoNote,
}: {
  partnershipId: string;
  stage: CmStage;
  exitReason: string | null;
  /** Server-computed: "Moves to X by itself when …" for the current stage, or null. */
  autoNote: string | null;
}) {
  const { pending, run } = useSave();
  const [closingAs, setClosingAs] = useState<CmStage | null>(null);
  const [askVideo, setAskVideo] = useState(false);

  const setStage = async (to: CmStage, reason?: string | null, videoUrl?: string) => {
    const r = await run(
      () => api(`/api/partnerships/${partnershipId}/stage`, { stage: to, exitReason: reason, videoUrl }),
      { success: `Stage set to ${stageLabel(to)}` },
    );
    setAskVideo(!r.ok && needsVideo(r.data));
    return r;
  };

  return (
    <div className="w-full max-w-xs space-y-1.5">
      <Field label="Stage">
        <Select
          value={stage}
          disabled={pending}
          onChange={(e) => {
            const to = e.target.value as CmStage;
            if (isTerminal(to)) setClosingAs(to);
            else {
              setClosingAs(null);
              setStage(to);
            }
          }}
        >
          {stagesByGroup().map((g) => (
            <optgroup key={g.group} label={g.label}>
              {g.stages.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>

      {askVideo ? (
        <VideoLinkPrompt
          pending={pending}
          onSubmit={(url) => setStage("posted", undefined, url)}
          onCancel={() => setAskVideo(false)}
        />
      ) : closingAs ? (
        <div className="rounded-lg border border-info-line bg-accent-soft p-2.5 text-xs">
          <div className="mb-1.5 font-medium text-text">
            Closing as {stageLabel(closingAs)} — why?
          </div>
          <div className="flex flex-wrap gap-1">
            {(EXIT_REASONS_BY_STAGE[closingAs] ?? []).map((r) => (
              <Button
                key={r.value}
                size="sm"
                pending={pending}
                onClick={async () => {
                  await setStage(closingAs, r.value);
                  setClosingAs(null);
                }}
              >
                {r.label}
              </Button>
            ))}
          </div>
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              className="text-text-faint hover:text-accent"
              onClick={async () => {
                await setStage(closingAs, null);
                setClosingAs(null);
              }}
            >
              Skip the reason
            </button>
            <button type="button" className="text-text-faint hover:text-accent" onClick={() => setClosingAs(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs text-text-muted">{stageHint(stage)}</p>
          {isTerminal(stage) && (
            <Field label="Why it ended" inline>
              <Select
                compact
                className="w-44"
                value={exitReason ?? ""}
                disabled={pending}
                onChange={(e) =>
                  run(
                    () =>
                      api(`/api/partnerships/${partnershipId}`, { exitReason: e.target.value || null }, "PATCH"),
                    { success: "Reason saved" },
                  )
                }
              >
                <option value="">Not recorded</option>
                {(EXIT_REASONS_BY_STAGE[stage] ?? []).map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {autoNote && <p className="text-[11px] leading-relaxed text-text-faint">{autoNote}</p>}
        </>
      )}
    </div>
  );
}

/* ── Timeline: anything that isn't a templated message ─────────── */

const HAPPENINGS = [
  { value: "dm_out", label: "We sent them a DM", direction: "outbound", channel: "ig_dm", kind: "outbound" },
  { value: "email_out", label: "We emailed them from our own inbox", direction: "outbound", channel: "email", kind: "outbound" },
  { value: "call", label: "We spoke on the phone", direction: "outbound", channel: "phone", kind: "outbound" },
  { value: "reply_dm", label: "They replied by DM", direction: "inbound", channel: "ig_dm", kind: "reply" },
  { value: "reply_email", label: "They replied to our own inbox", direction: "inbound", channel: "email", kind: "reply" },
  { value: "note", label: "Internal note", direction: "outbound", channel: "other", kind: "note" },
] as const;

/**
 * Logs calls, notes and off-app messages onto the timeline, today or on an
 * earlier date. Email on threads the mailbox is on arrives by itself; this
 * covers everything else. An email logged here is never read by the email
 * reader — there is nothing stored to read.
 */
export function TimelineNote({
  partnershipId,
  hasOutbound,
}: {
  partnershipId: string;
  /** Decides whether an outbound message is a first message or a follow-up. */
  hasOutbound: boolean;
}) {
  const { pending, run } = useSave();
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState<(typeof HAPPENINGS)[number]["value"]>("reply_dm");
  const [body, setBody] = useState("");
  const [when, setWhen] = useState<WhenChoice>("today");
  const [picked, setPicked] = useState(defaultPickedDate);

  const submit = async () => {
    const h = HAPPENINGS.find((x) => x.value === what)!;
    const kind = h.kind === "outbound" ? (hasOutbound ? "follow_up" : "initial") : h.kind;
    const r = await run(
      () =>
        api<{ stageSkipped?: boolean }>("/api/outreach", {
          partnershipId,
          direction: h.direction,
          channel: h.channel,
          kind,
          body: body.trim() || undefined,
          occurredAt: whenToIso(when, picked),
        }),
      { success: "Added to the timeline", undo: true },
    );
    if (r.ok) {
      if (r.data.stageSkipped) toast("The stage didn't move", { tone: "info", detail: "Someone set it by hand after that date, so an older message doesn't change it." });
      setBody("");
      setWhen("today");
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <Button variant="link" icon={<Plus size={13} />} onClick={() => setOpen(true)}>
        Log a call or DM
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-2/60 p-3">
      <Field
        label="What happened?"
        hint={what === "email_out" || what === "reply_email" ? "Only for email the connected mailbox can't see — it picks up the rest by itself." : undefined}
      >
        <Select compact value={what} onChange={(e) => setWhat(e.target.value as typeof what)}>
          {HAPPENINGS.map((h) => (
            <option key={h.value} value={h.value}>
              {h.label}
            </option>
          ))}
        </Select>
      </Field>
      <DateChoice choice={when} picked={picked} onChoice={setWhen} onPicked={setPicked} />
      <Field label="What was said (optional)">
        <Textarea compact value={body} onChange={(e) => setBody(e.target.value)} rows={2} />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={submit} pending={pending} disabled={when === "pick" && !picked} icon={<SendIcon size={13} />}>
          Save to timeline
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ── Shipment ─────────────────────────────────────────────────── */

const SHIP_STATES = [
  { value: "ready", label: "Not sent yet", title: "Address in hand, not sent yet" },
  { value: "shipped", label: "Shipped", title: "On its way — add the tracking number" },
  { value: "delivered", label: "Delivered", title: "It landed — send the brief" },
  { value: "returned", label: "Returned", title: "Came back to us" },
] as const;

type ShipState = (typeof SHIP_STATES)[number]["value"];

export function ShipmentControls({
  partnershipId,
  shipment,
}: {
  partnershipId: string;
  shipment: CmShipment | null;
}) {
  const { pending, run } = useSave();
  const [carrier, setCarrier] = useState(shipment?.carrier ?? "");
  const [tracking, setTracking] = useState(shipment?.trackingNumber ?? "");
  const dirty = carrier !== (shipment?.carrier ?? "") || tracking !== (shipment?.trackingNumber ?? "");

  const save = (status: ShipState, successText: string) =>
    run(
      () =>
        api("/api/shipments", {
          id: shipment?.id,
          partnershipId,
          status,
          carrier: carrier || null,
          trackingNumber: tracking || null,
        }),
      // Undo appears only when the server recorded a status change to shipped or delivered.
      { success: successText, undo: true },
    );

  return (
    <div className="space-y-2.5">
      <FieldGroup label="Shipment status">
        <Segmented<ShipState>
          aria-label="Shipment status"
          value={(shipment?.status as ShipState | undefined) ?? null}
          disabled={pending}
          onChange={(s) => save(s, `Shipment marked ${s}`)}
          options={SHIP_STATES.map((s) => ({ value: s.value, label: s.label, title: s.title }))}
        />
      </FieldGroup>
      <div className="grid grid-cols-[7rem_1fr] gap-2">
        <Field label="Carrier">
          <Input compact value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="UPS" />
        </Field>
        <Field label="Tracking number">
          <Input compact value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="1Z…" />
        </Field>
      </div>
      {dirty && (
        <Button
          size="sm"
          variant="primary"
          pending={pending}
          onClick={() => save((shipment?.status as ShipState | undefined) ?? "ready", "Shipment details saved")}
        >
          Save shipment details
        </Button>
      )}
    </div>
  );
}

/* ── Deliverables ─────────────────────────────────────────────── */

export function AddDeliverable({ partnershipId }: { partnershipId: string }) {
  const { pending, run } = useSave();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [showOverride, setShowOverride] = useState(false);
  const [publicViews, setPublicViews] = useState("");

  const submit = async () => {
    const r = await run(
      () =>
        api("/api/deliverables", {
          partnershipId,
          url,
          publicViews: publicViews ? Number(publicViews) : null,
        }),
      { success: "Video added" },
    );
    if (r.ok) {
      setUrl("");
      setPublicViews("");
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <Button size="sm" icon={<Plus size={13} />} onClick={() => setOpen(true)}>
        Add posted video
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-lg border border-border bg-surface-2/60 p-3">
      <Field label="Video link" hint="Paste the link to the posted video. Saving it moves them to Posted.">
        <Input compact value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.instagram.com/reel/…" autoFocus />
      </Field>
      {showOverride ? (
        <Field label="Public views — as shown in the Instagram app" hint="Only enter this if you read it off Instagram yourself; it's recorded as verified.">
          <Input compact value={publicViews} onChange={(e) => setPublicViews(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" />
        </Field>
      ) : (
        <Button variant="link" onClick={() => setShowOverride(true)} className="text-xs">
          Add the view count shown on Instagram (optional)
        </Button>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={submit} pending={pending} disabled={!url}>
          Save video
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ── Agreement ────────────────────────────────────────────────── */

export function AgreementEditor({
  partnershipId,
  agreementType,
  agreedTerms,
  notes,
}: {
  partnershipId: string;
  agreementType: string | null;
  agreedTerms: string | null;
  notes: string | null;
}) {
  const { pending, run } = useSave();
  const [type, setType] = useState(agreementType ?? "");
  const [terms, setTerms] = useState(agreedTerms ?? "");
  const [noteText, setNoteText] = useState(notes ?? "");

  const patch = (body: Record<string, unknown>, success: string) =>
    run(() => api(`/api/partnerships/${partnershipId}`, body, "PATCH"), { success });

  return (
    <div className="space-y-2.5">
      <Field label="Agreement" inline>
        <Select
          compact
          className="w-40"
          value={type}
          disabled={pending}
          onChange={(e) => {
            setType(e.target.value);
            patch({ agreementType: e.target.value || null }, "Agreement saved");
          }}
        >
          <option value="">None yet</option>
          <option value="verbal">Verbal</option>
          <option value="signed">Signed</option>
        </Select>
      </Field>
      <Field label="Agreed terms" hint="Deliverables, timeline, exclusivity. Saves when you click away.">
        <Textarea
          compact
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          onBlur={() => terms !== (agreedTerms ?? "") && patch({ agreedTerms: terms || null }, "Terms saved")}
          rows={2}
        />
      </Field>
      <Field label="Deal notes">
        <Textarea
          compact
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          onBlur={() => noteText !== (notes ?? "") && patch({ notes: noteText || null }, "Notes saved")}
          rows={2}
        />
      </Field>
    </div>
  );
}

export function FeeEditor({
  partnershipId,
  feeAmount,
  compensationType,
}: {
  partnershipId: string;
  feeAmount: string | null;
  compensationType: string | null;
}) {
  const { pending, run } = useSave();
  const [comp, setComp] = useState(compensationType ?? "free_product");
  const [fee, setFee] = useState(feeAmount ?? "");

  const save = (nextComp: string, nextFee: string) =>
    run(
      () =>
        api(
          `/api/partnerships/${partnershipId}`,
          { compensationType: nextComp, feeAmount: nextFee === "" ? null : nextFee },
          "PATCH",
        ),
      { success: "Compensation saved" },
    );

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Compensation">
        <Select
          compact
          className="w-40"
          value={comp}
          disabled={pending}
          onChange={(e) => {
            setComp(e.target.value);
            save(e.target.value, fee);
          }}
        >
          <option value="free_product">Product only</option>
          <option value="flat_fee">Fee only</option>
          <option value="hybrid">Product + fee</option>
        </Select>
      </Field>
      {comp !== "free_product" && (
        <Field label="Fee (USD)">
          <Input
            compact
            className="w-28"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            onBlur={() => fee !== (feeAmount ?? "") && save(comp, fee)}
            placeholder="0"
            inputMode="decimal"
            disabled={pending}
          />
        </Field>
      )}
    </div>
  );
}

/** Brief link + "mark sent". */
export function BriefEditor({
  partnershipId,
  briefUrl,
  briefSentAt,
}: {
  partnershipId: string;
  briefUrl: string | null;
  briefSentAt: string | null; // pre-formatted date or null
}) {
  const { pending, run } = useSave();
  const [url, setUrl] = useState(briefUrl ?? "");

  const patch = (body: Record<string, unknown>, success: string) =>
    run(() => api(`/api/partnerships/${partnershipId}`, body, "PATCH"), { success });

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Brief link" className="min-w-0 flex-1" hint={briefSentAt ? `Sent ${briefSentAt}` : "Google Doc, Notion… saves when you click away."}>
        <Input
          compact
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => url !== (briefUrl ?? "") && patch({ briefUrl: url || null }, "Brief link saved")}
          placeholder="https://…"
        />
      </Field>
      {!briefSentAt && (
        <Button
          size="sm"
          pending={pending}
          disabled={!url}
          title={url ? "Records today as the date the brief went out" : "Add the brief link first"}
          onClick={() => patch({ briefSentAt: new Date().toISOString() }, "Brief marked sent")}
          className="mb-5"
        >
          Mark brief sent
        </Button>
      )}
    </div>
  );
}

/** Small disclosure used by the record page for secondary controls. */
export function Disclosure({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-accent"
      >
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {label}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
