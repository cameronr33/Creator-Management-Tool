"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { FileText, RotateCw, Trash2, Upload } from "lucide-react";
import { Badge, Button, Callout, IconButton, Input, Spinner } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { api, useSave } from "@/components/use-save";
import { toast } from "@/components/toast";
import type { DealDifference } from "@/lib/deal-facts";

export interface ContractRow {
  id: string;
  source: "upload" | "email";
  filename: string;
  sizeBytes: number | null;
  received: string;
  readStatus: "pending" | "reading" | "read" | "not_contract" | "failed";
  readError: string | null;
  filled: string[];
  downloaded: boolean;
  signed: boolean;
  /** An email attachment that couldn't be fetched three times — waiting for "Try again". */
  givenUp: boolean;
  /** A read that died mid-way (a deploy, a crash) — can be read again. */
  stale: boolean;
}

export type OfferedDifference = DealDifference & { from: string };

function size(n: number | null): string {
  if (!n) return "";
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function Status({ c }: { c: ContractRow }) {
  if (c.readStatus === "not_contract") return <Badge tone="muted">{c.readError ? "Someone else's contract" : "Not a contract"}</Badge>;
  if (c.givenUp) return <Badge tone="bad">Couldn&apos;t fetch it from email</Badge>;
  if (!c.downloaded) return <Badge tone="muted">Fetching from email on the next check</Badge>;
  if (c.stale) return <Badge tone="bad">Reading stopped</Badge>;
  switch (c.readStatus) {
    case "pending":
      if (c.readError) return <Badge tone="muted">Waiting to be read</Badge>;
    // falls through
    case "reading":
      return (
        <Badge tone="info">
          <Spinner size={11} /> Reading…
        </Badge>
      );
    case "read":
      return <Badge tone="good">{c.signed ? "Signed contract" : "Contract (not signed)"}</Badge>;
    case "failed":
      return <Badge tone="bad">Couldn&apos;t read it</Badge>;
  }
}

/**
 * The deal's contracts: upload a PDF, or it arrives attached to their email.
 * Each is read once and fills the deal's blank fields; where it disagrees
 * with what's already recorded, the difference is offered — never applied.
 */
export function Contracts({ partnershipId, contracts, differences }: { partnershipId: string; contracts: ContractRow[]; differences: OfferedDifference[] }) {
  const { pending, run } = useSave();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const reading = contracts.some((c) => c.downloaded && !c.stale && !c.readError && (c.readStatus === "pending" || c.readStatus === "reading"));

  // While a file is being read, look again every few seconds (for two minutes at most).
  useEffect(() => {
    if (!reading) return;
    let n = 0;
    const t = setInterval(() => {
      if (++n > 30) clearInterval(t);
      else router.refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [reading, router]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    const r = await run(async () => {
      const res = await fetch(`/api/partnerships/${partnershipId}/contracts`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    });
    if (r.ok) toast((r.data as { duplicate?: boolean }).duplicate ? "That file is already here" : "Uploaded — reading it now", { tone: "good" });
    if (input.current) input.current.value = "";
  };

  const applyDifference = (d: OfferedDifference) =>
    run(
      () =>
        d.product
          ? api("/api/products", { partnershipId, productName: d.product.productName, quantity: d.product.quantity })
          : api(`/api/partnerships/${partnershipId}`, d.patch ?? {}, "PATCH"),
      { success: `${d.label} updated` },
    );
  const keepMine = (d: OfferedDifference) => run(() => api(`/api/partnerships/${partnershipId}`, { dismissDeal: d.key }, "PATCH"));

  return (
    <div className="space-y-3">
      {differences.length > 0 && (
        <Callout tone="info" title="Something here differs from what's recorded">
          <ul className="mt-1 space-y-2">
            {differences.map((d) => (
              <li key={d.key} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-medium text-text">{d.label}:</span> {d.from} says <span className="font-medium text-text">{d.theirs}</span>
                  {d.ours !== "not listed" ? <span className="text-text-muted"> — you have {d.ours}</span> : <span className="text-text-muted"> — not in your list</span>}
                </span>
                <span className="flex gap-1.5">
                  <Button size="sm" variant="primary" pending={pending} onClick={() => applyDifference(d)}>
                    {d.product ? "Add it" : "Use it"}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => keepMine(d)}>
                    Keep mine
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {contracts.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {contracts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <FileText size={14} className="shrink-0 text-text-muted" />
                  {c.downloaded ? (
                    <a href={`/api/contracts/${c.id}`} target="_blank" rel="noreferrer" className="truncate text-sm font-medium text-accent hover:underline">
                      {c.filename}
                    </a>
                  ) : (
                    <span className="truncate text-sm font-medium text-text">{c.filename}</span>
                  )}
                  <Status c={c} />
                </div>
                <div className="text-xs text-text-muted">
                  {c.source === "email" ? "From their email" : "Uploaded"} · {c.received}
                  {c.sizeBytes ? ` · ${size(c.sizeBytes)}` : ""}
                </div>
                {c.readStatus === "read" && (
                  <div className="text-xs text-text-muted">{c.filled.length ? `Filled in: ${c.filled.join(", ")}` : "Nothing was blank to fill — any differences are shown above."}</div>
                )}
                {(c.readStatus === "failed" || c.givenUp || c.readStatus === "not_contract" || c.readStatus === "pending") && c.readError && (
                  <div className={c.readStatus === "not_contract" ? "text-xs text-text-muted" : "text-xs text-bad"}>{c.readError}</div>
                )}
              </div>
              <div className="flex items-center gap-1">
                {((c.downloaded && c.readStatus !== "pending" && c.readStatus !== "reading") || c.stale || c.givenUp) && (
                  <IconButton
                    label={c.givenUp ? "Try fetching it again" : "Read it again"}
                    icon={<RotateCw size={14} />}
                    pending={pending}
                    onClick={() => run(() => api(`/api/contracts/${c.id}`), { success: c.givenUp ? "It will be fetched on the next email check" : "Reading it again" })}
                  />
                )}
                <ConfirmButton
                  label="Remove this file"
                  iconOnly
                  icon={<Trash2 size={14} />}
                  question="Remove the file? What it filled in stays."
                  confirmLabel="Remove"
                  pending={pending}
                  onConfirm={() => run(() => api(`/api/contracts/${c.id}`, undefined, "DELETE"), { success: "File removed" })}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="Contract PDF" onChange={(e) => upload(e.target.files?.[0])} />
        <Button size="sm" icon={<Upload size={13} />} pending={pending} onClick={() => input.current?.click()}>
          Upload contract (PDF)
        </Button>
        <span className="text-xs text-text-faint">Blank fields below fill in from it. PDFs attached to their emails are picked up too.</span>
      </div>
    </div>
  );
}
