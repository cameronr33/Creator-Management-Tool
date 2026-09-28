import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { stageLabel } from "@/lib/stages";
import type { CmStage } from "@/lib/db/schema";

/**
 * The one way client components talk to the API.
 *
 * Every save used to have its own fetch + `if (res.ok) router.refresh()` and
 * nothing on failure. `useSave().run()` gives all of them the same contract:
 * a success toast when asked, an error toast always, an "auto-stage" toast
 * whenever the server moved the pipeline as a side effect, and one refresh.
 * With `undo`, a quick button's toast carries an Undo for ten seconds (the
 * server keeps what the press did and decides whether it can still be undone).
 */

export interface StageChange {
  from: CmStage;
  to: CmStage;
}

/** A quick button's press, as the server recorded it (src/lib/quick-actions.ts). */
export interface QuickUndo {
  actionId: string;
  partnershipId: string;
}

export type ApiData<T> = T & { ok?: boolean; error?: string; stageChanged?: StageChange | null; undo?: QuickUndo | null };

export interface ApiResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: ApiData<T>;
}

export async function api<T = Record<string, unknown>>(
  url: string,
  body?: unknown,
  method = "POST",
): Promise<ApiResult<T>> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as ApiData<T>;
  return { ok: res.ok && data.ok !== false, status: res.status, data };
}

export function describeStageChange(c: StageChange): string {
  return `Stage moved automatically: ${stageLabel(c.from)} → ${stageLabel(c.to)}`;
}

export interface RunOptions {
  /** Toast to show on success (omit for quiet saves — the refresh is the feedback). */
  success?: string;
  /** Skip router.refresh() — for saves whose UI already reflects the change. */
  refresh?: boolean;
  /** Offer Undo on the success toast when the server recorded the press. */
  undo?: boolean;
}

export const UNDO_TOAST_MS = 10_000;

export function useSave() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function run<T = Record<string, unknown>>(
    fn: () => Promise<ApiResult<T>>,
    opts: RunOptions = {},
  ): Promise<ApiResult<T>> {
    setPending(true);
    let r: ApiResult<T>;
    try {
      r = await fn();
    } catch (e) {
      r = { ok: false, status: 0, data: { error: (e as Error).message } as ApiData<T> };
    }
    setPending(false);

    if (r.ok) {
      const undo = opts.undo ? r.data.undo : null;
      if (undo) {
        // One toast: what happened, the stage move it caused, and Undo.
        toast(opts.success ?? "Saved", {
          tone: "good",
          detail: r.data.stageChanged ? describeStageChange(r.data.stageChanged) : undefined,
          action: { label: "Undo", onClick: () => void undoPress(undo) },
          durationMs: UNDO_TOAST_MS,
        });
      } else {
        if (opts.success) toast(opts.success, { tone: "good" });
        if (r.data.stageChanged) toast(describeStageChange(r.data.stageChanged));
      }
      if (opts.refresh !== false) router.refresh();
    } else {
      toast(r.data.error ?? (r.status ? `Couldn't save (HTTP ${r.status})` : "Couldn't reach the server"), {
        tone: "bad",
      });
    }
    return r;
  }

  async function undoPress(u: QuickUndo) {
    const r = await api<{ stage?: CmStage | null }>(`/api/partnerships/${u.partnershipId}/undo`, { actionId: u.actionId }).catch(
      () => ({ ok: false, status: 0, data: { error: "Couldn't reach the server" } }) as ApiResult<{ stage?: CmStage | null }>,
    );
    if (r.ok) toast(r.data.stage ? `Undone — back to ${stageLabel(r.data.stage)}` : "Undone", { tone: "good" });
    else toast(r.data.error ?? "Couldn't undo it", { tone: "bad" });
    router.refresh();
  }

  return { pending, run };
}
