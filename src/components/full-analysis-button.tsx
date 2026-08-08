"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, Clock, AlertTriangle, RotateCcw } from "lucide-react";
import type { CmResearchRequest } from "@/lib/db/schema";
import { shortDate } from "@/lib/format";

const POLL_MS = 5000;

async function fetchLatest(partnershipId: string): Promise<CmResearchRequest | null> {
  const res = await fetch(`/api/analyze?partnershipId=${partnershipId}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.request ?? null;
}

/**
 * "Full Analysis" button — kicks off the two-pass research described in the
 * plan: an instant server-side Apify pass (labeled `est` throughout the app)
 * plus a queued accurate pass a local machine runs with the real
 * creator-research skill (Chrome grid scrape + vision descriptions).
 *
 * Polls only while a request is open (queued/running) so the panel updates
 * itself as quickPassAt lands and again once the local runner finishes —
 * without polling forever once a request settles.
 */
export function FullAnalysisButton({
  partnershipId,
  initialRequest,
}: {
  partnershipId: string;
  initialRequest: CmResearchRequest | null;
}) {
  const router = useRouter();
  const [request, setRequest] = useState(initialRequest);
  const [starting, setStarting] = useState(false);
  const seenRunning = useRef(false);

  const isOpen = request?.status === "queued" || request?.status === "running";

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(async () => {
      const latest = await fetchLatest(partnershipId);
      setRequest(latest);
      if (latest?.status && latest.status !== "queued" && latest.status !== "running") {
        // Just settled — refresh the page data (creator record, reels, etc.)
        // once, then stop polling.
        router.refresh();
      } else if (latest?.quickPassAt && !seenRunning.current) {
        // The instant pass just landed — refresh once to show the est. data,
        // keep polling for the accurate pass.
        seenRunning.current = true;
        router.refresh();
      }
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [isOpen, partnershipId, router]);

  const start = async () => {
    setStarting(true);
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partnershipId }),
    });
    const data = await res.json().catch(() => ({}));
    setStarting(false);
    if (data.ok) {
      setRequest(data.request);
      router.refresh();
    }
  };

  // No request yet, or the last one is fully settled — offer a fresh run.
  if (!request || (!isOpen && request.status !== "completed" && request.status !== "failed")) {
    return (
      <button
        onClick={start}
        disabled={starting}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-text-muted transition hover:bg-surface-2 disabled:opacity-60"
      >
        {starting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
        Full Analysis
      </button>
    );
  }

  if (isOpen && !request.quickPassAt) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-text-muted">
        <Loader2 size={13} className="animate-spin" /> Analyzing…
      </span>
    );
  }

  if (request.status === "queued") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-amber-700">
        <Clock size={13} /> Est. data shown — accurate pass queued for your machine
      </span>
    );
  }

  if (request.status === "running") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-accent">
        <Loader2 size={13} className="animate-spin" /> Full analysis running on your machine…
      </span>
    );
  }

  if (request.status === "failed") {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="flex items-center gap-1 text-red-600" title={request.error ?? undefined}>
          <AlertTriangle size={13} /> Analysis failed
        </span>
        <button
          onClick={start}
          disabled={starting}
          className="flex items-center gap-1 text-accent hover:underline disabled:opacity-60"
        >
          <RotateCcw size={12} /> Retry
        </button>
      </div>
    );
  }

  // completed
  return (
    <div className="flex items-center gap-2 text-xs text-text-muted">
      <span>Analyzed {request.completedAt ? shortDate(request.completedAt) : shortDate(request.quickPassAt)}</span>
      <button
        onClick={start}
        disabled={starting}
        className="flex items-center gap-1 text-accent hover:underline disabled:opacity-60"
      >
        {starting ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
        Re-run
      </button>
    </div>
  );
}
