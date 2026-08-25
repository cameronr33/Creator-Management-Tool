"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, Plus, Reply } from "lucide-react";
import { STAGES } from "@/lib/stages";
import type { CmStage, CmShipment } from "@/lib/db/schema";

async function post(url: string, body: unknown, method = "POST") {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

function useRefreshingAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const run = async (fn: () => Promise<boolean>) => {
    setPending(true);
    const ok = await fn();
    setPending(false);
    if (ok) router.refresh();
    return ok;
  };
  return { pending, run };
}

export function StageSelect({ partnershipId, stage }: { partnershipId: string; stage: CmStage }) {
  const { pending, run } = useRefreshingAction();
  return (
    <select
      value={stage}
      disabled={pending}
      onChange={(e) =>
        run(() => post(`/api/partnerships/${partnershipId}/stage`, { stage: e.target.value }))
      }
      className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm font-medium outline-none focus:border-accent disabled:opacity-60"
    >
      {STAGES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

const CHANNELS = [
  { value: "ig_dm", label: "IG DM" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "other", label: "Other" },
];

export function OutreachComposer({
  partnershipId,
  suggestedMessage,
}: {
  partnershipId: string;
  suggestedMessage: string | null;
}) {
  const { pending, run } = useRefreshingAction();
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [channel, setChannel] = useState("ig_dm");
  const [kind, setKind] = useState("follow_up");
  const [body, setBody] = useState("");
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!suggestedMessage) return;
    await navigator.clipboard.writeText(suggestedMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const submit = async () => {
    const ok = await run(() =>
      post("/api/outreach", { partnershipId, direction, channel, kind, body: body || undefined }),
    );
    if (ok) setBody("");
  };

  // The most common event after a send, reduced to one click.
  const quickReply = () =>
    run(() =>
      post("/api/outreach", { partnershipId, direction: "inbound", channel, kind: "reply" }),
    );

  return (
    <div className="space-y-2">
      <button
        onClick={quickReply}
        disabled={pending}
        className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm text-text-muted transition hover:bg-surface-2 disabled:opacity-50"
        title="Log an inbound reply in one click"
      >
        <Reply size={14} /> They replied
      </button>
      {suggestedMessage && (
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">
              Suggested message
            </span>
            <button
              onClick={copy}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-accent hover:bg-accent-soft"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="whitespace-pre-wrap text-sm text-text-muted">{suggestedMessage}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <select value={direction} onChange={(e) => setDirection(e.target.value as "outbound" | "inbound")} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm">
          <option value="outbound">We sent</option>
          <option value="inbound">They replied</option>
        </select>
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm">
          {CHANNELS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm">
          <option value="initial">Initial</option>
          <option value="follow_up">Follow-up</option>
          <option value="reply">Reply</option>
          <option value="note">Note</option>
        </select>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What was said (optional)…"
        rows={2}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <button
        onClick={submit}
        disabled={pending}
        className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
      >
        Log touchpoint
      </button>
    </div>
  );
}

const SHIP_STATES = ["ready", "shipped", "delivered", "returned"] as const;

export function ShipmentControls({
  partnershipId,
  shipment,
}: {
  partnershipId: string;
  shipment: CmShipment | null;
}) {
  const { pending, run } = useRefreshingAction();
  const [carrier, setCarrier] = useState(shipment?.carrier ?? "");
  const [tracking, setTracking] = useState(shipment?.trackingNumber ?? "");

  const save = (status: string) =>
    run(() =>
      post("/api/shipments", {
        id: shipment?.id,
        partnershipId,
        status,
        carrier: carrier || null,
        trackingNumber: tracking || null,
      }),
    );

  // Blur always persists — with no shipment yet, this creates one at "ready"
  // so typed carrier/tracking values are never silently discarded.
  const saveOnBlur = () => {
    if (!carrier && !tracking && !shipment) return;
    save(shipment?.status ?? "ready");
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {SHIP_STATES.map((s) => {
          const active = shipment?.status === s;
          return (
            <button
              key={s}
              disabled={pending}
              onClick={() => save(s)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition disabled:opacity-60 ${
                active
                  ? "bg-accent text-white"
                  : "border border-border bg-surface text-text-muted hover:bg-surface-2"
              }`}
            >
              {s}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <input
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
          onBlur={saveOnBlur}
          placeholder="Carrier"
          className="w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
        <input
          value={tracking}
          onChange={(e) => setTracking(e.target.value)}
          onBlur={saveOnBlur}
          placeholder="Tracking #"
          className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
      </div>
      {!shipment && (
        <button
          onClick={() => save("ready")}
          disabled={pending}
          className="flex items-center gap-1 text-sm text-accent hover:underline"
        >
          <Plus size={14} /> Create shipment
        </button>
      )}
    </div>
  );
}

export function AddDeliverable({ partnershipId }: { partnershipId: string }) {
  const { pending, run } = useRefreshingAction();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [showOverride, setShowOverride] = useState(false);
  const [publicViews, setPublicViews] = useState("");
  const [warning, setWarning] = useState<string | null>(null);

  const submit = async () => {
    setWarning(null);
    let warn: string | null = null;
    const ok = await run(async () => {
      const res = await fetch("/api/deliverables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnershipId,
          url,
          // Metrics + posted date come from Apify (labeled provisional);
          // the operator only types a number for a true public-Views reading.
          fetchMetrics: true,
          publicViews: publicViews ? Number(publicViews) : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      warn = data?.warning ?? null;
      return res.ok;
    });
    setWarning(warn);
    if (ok && !warn) {
      setUrl("");
      setPublicViews("");
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-sm text-accent hover:underline">
        <Plus size={14} /> Add posted video
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-3">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://instagram.com/reel/…"
        className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
      />
      {showOverride ? (
        <input
          value={publicViews}
          onChange={(e) => setPublicViews(e.target.value)}
          placeholder="Public views — as read from the IG app"
          inputMode="numeric"
          className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
      ) : (
        <button
          onClick={() => setShowOverride(true)}
          className="text-xs text-text-faint hover:text-accent"
        >
          I read the public view count off Instagram — enter it manually
        </button>
      )}
      {warning && <p className="text-xs text-amber-700">⚠ {warning}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={pending || !url}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? "Fetching metrics…" : "Save & fetch metrics"}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-text-muted hover:bg-surface-2">
          Cancel
        </button>
      </div>
    </div>
  );
}

const EXIT_REASONS = [
  { value: "below_cadence", label: "Below cadence (we passed)" },
  { value: "wrong_pillar", label: "Wrong pillar (we passed)" },
  { value: "fee_too_high", label: "Fee too high (we passed)" },
  { value: "budget", label: "Budget (we passed)" },
  { value: "research_fit", label: "Research fit (we passed)" },
  { value: "not_interested", label: "Not interested (they passed)" },
  { value: "competitor_conflict", label: "Competitor conflict (they passed)" },
  { value: "wants_more_money", label: "Wants more money (they passed)" },
  { value: "went_dark", label: "Went dark" },
  { value: "other", label: "Other" },
];

/**
 * Edits the agreement fields that previously had no UI at all —
 * agreementType, agreedTerms, exitReason and partnership notes were
 * PATCH-able via the API but rendered read-only.
 */
export function AgreementEditor({
  partnershipId,
  agreementType,
  agreedTerms,
  exitReason,
  notes,
  isTerminal,
}: {
  partnershipId: string;
  agreementType: string | null;
  agreedTerms: string | null;
  exitReason: string | null;
  notes: string | null;
  isTerminal: boolean;
}) {
  const { pending, run } = useRefreshingAction();
  const [type, setType] = useState(agreementType ?? "");
  const [terms, setTerms] = useState(agreedTerms ?? "");
  const [reason, setReason] = useState(exitReason ?? "");
  const [noteText, setNoteText] = useState(notes ?? "");

  const patch = (body: Record<string, unknown>) =>
    run(() => post(`/api/partnerships/${partnershipId}`, body, "PATCH"));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-text-muted">Type</span>
        <select
          value={type}
          disabled={pending}
          onChange={(e) => {
            setType(e.target.value);
            patch({ agreementType: e.target.value || null });
          }}
          className="rounded-lg border border-border bg-surface px-2 py-1 text-sm"
        >
          <option value="">—</option>
          <option value="verbal">Verbal</option>
          <option value="signed">Signed</option>
        </select>
      </div>
      <textarea
        value={terms}
        onChange={(e) => setTerms(e.target.value)}
        onBlur={() => terms !== (agreedTerms ?? "") && patch({ agreedTerms: terms || null })}
        placeholder="Agreed terms — deliverables, timeline, exclusivity…"
        rows={2}
        className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
      />
      {isTerminal && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-text-muted">Exit reason</span>
          <select
            value={reason}
            disabled={pending}
            onChange={(e) => {
              setReason(e.target.value);
              patch({ exitReason: e.target.value || null });
            }}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-sm"
          >
            <option value="">—</option>
            {EXIT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      )}
      <textarea
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
        onBlur={() => noteText !== (notes ?? "") && patch({ notes: noteText || null })}
        placeholder="Partnership notes…"
        rows={2}
        className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
      />
    </div>
  );
}

/** Brief link + "mark sent" — previously read-only despite API support. */
export function BriefEditor({
  partnershipId,
  briefUrl,
  briefSentAt,
}: {
  partnershipId: string;
  briefUrl: string | null;
  briefSentAt: string | null; // pre-formatted date or null
}) {
  const { pending, run } = useRefreshingAction();
  const [url, setUrl] = useState(briefUrl ?? "");

  const patch = (body: Record<string, unknown>) =>
    run(() => post(`/api/partnerships/${partnershipId}`, body, "PATCH"));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onBlur={() => url !== (briefUrl ?? "") && patch({ briefUrl: url || null })}
        placeholder="Brief URL (Google Doc, Notion…)"
        className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
      />
      {briefSentAt ? (
        <span className="text-xs text-text-faint">Sent {briefSentAt}</span>
      ) : (
        <button
          onClick={() => patch({ briefSentAt: new Date().toISOString() })}
          disabled={pending || !url}
          className="rounded-lg border border-border px-2 py-1.5 text-xs text-text-muted transition hover:bg-surface-2 disabled:opacity-50"
        >
          Mark brief sent now
        </button>
      )}
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
  const { pending, run } = useRefreshingAction();
  const [comp, setComp] = useState(compensationType ?? "free_product");
  const [fee, setFee] = useState(feeAmount ?? "");

  const save = () =>
    run(() =>
      post(
        `/api/partnerships/${partnershipId}`,
        { compensationType: comp, feeAmount: fee === "" ? null : fee },
        "PATCH",
      ),
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={comp}
        onChange={(e) => setComp(e.target.value)}
        onBlur={save}
        className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
      >
        <option value="free_product">Free product</option>
        <option value="flat_fee">Flat fee</option>
        <option value="hybrid">Hybrid</option>
      </select>
      {comp !== "free_product" && (
        <div className="flex items-center gap-1">
          <span className="text-sm text-text-muted">$</span>
          <input
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            onBlur={save}
            placeholder="0"
            inputMode="decimal"
            disabled={pending}
            className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
        </div>
      )}
    </div>
  );
}
