"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Clock, AlertTriangle, RotateCcw } from "lucide-react";
import type { CmResearchRequest } from "@/lib/db/schema";
import { shortDate } from "@/lib/format";
import { Button, Spinner } from "@/components/ui";
import { api, useSave } from "@/components/use-save";

const POLL_MS = 5000;

async function fetchLatest(partnershipId: string): Promise<CmResearchRequest | null> {
  const res = await fetch(`/api/analyze?partnershipId=${partnershipId}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.request ?? null;
}

/**
 * "Run full research" — kicks off the two-pass research: an instant
 * server-side pass (numbers labelled estimated) plus a queued verified pass a
 * local machine runs with the real creator-research skill.
 *
 * Polls only while a request is open (queued/running) so the panel updates
 * itself as the quick pass lands and again once the local runner finishes.
 */
export function FullAnalysisButton({
  partnershipId,
  initialRequest,
}: {
  partnershipId: string;
  initialRequest: CmResearchRequest | null;
}) {
  const router = useRouter();
  const { pending, run } = useSave();
  const [request, setRequest] = useState(initialRequest);
  const seenRunning = useRef(false);

  const isOpen = request?.status === "queued" || request?.status === "running";

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(async () => {
      const latest = await fetchLatest(partnershipId);
      setRequest(latest);
      if (latest?.status && latest.status !== "queued" && latest.status !== "running") {
        router.refresh();
      } else if (latest?.quickPassAt && !seenRunning.current) {
        seenRunning.current = true;
        router.refresh();
      }
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [isOpen, partnershipId, router]);

  const start = async () => {
    const r = await run(() => api<{ request?: CmResearchRequest }>("/api/analyze", { partnershipId }), {
      success: "Research started — estimates land in about a minute",
    });
    if (r.ok && r.data.request) setRequest(r.data.request);
  };

  const startButton = (label: string, icon = <Sparkles size={13} />) => (
    <Button
      size="sm"
      icon={icon}
      pending={pending}
      onClick={start}
      title="Pulls the latest reels for estimated numbers now, and queues the verified pass for the owner's machine"
    >
      {label}
    </Button>
  );

  if (!request || (!isOpen && request.status !== "completed" && request.status !== "failed")) {
    return startButton("Run full research");
  }

  if (isOpen && !request.quickPassAt) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-text-muted">
        <Spinner size={13} /> Pulling reels…
      </span>
    );
  }

  if (request.status === "queued") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-warn" title="Verified numbers need a logged-in browser, so that pass runs on the owner's machine">
        <Clock size={13} /> Estimates shown — verified numbers arrive after the next research run
      </span>
    );
  }

  if (request.status === "running") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-accent">
        <Spinner size={13} /> Verified research running…
      </span>
    );
  }

  if (request.status === "failed") {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="flex items-center gap-1 text-bad" title={request.error ?? undefined}>
          <AlertTriangle size={13} /> Research failed
        </span>
        {startButton("Retry", <RotateCcw size={12} />)}
      </div>
    );
  }

  // completed
  return (
    <div className="flex items-center gap-2 text-xs text-text-muted">
      <span>Researched {request.completedAt ? shortDate(request.completedAt) : shortDate(request.quickPassAt)}</span>
      {startButton("Re-run", <RotateCcw size={12} />)}
    </div>
  );
}
