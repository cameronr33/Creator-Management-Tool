import { useEffect, useRef, useState, useTransition } from "react";
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
 *
 * Interaction review 2026-09-30: `pending` lasts until the refreshed page has
 * landed, not just until the server answered, and the success toast waits for
 * it too — so the press, the change on screen and "Saved" arrive together
 * (before, "Saved" showed while the row still looked unchanged). If the
 * component leaves the page with the refresh (the row moved away), its toast
 * shows then.
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

/** A stage a person just picked (src/lib/email-status.ts undoMove: theirs, within ten minutes). */
export interface MoveUndo {
  transitionId: string;
  partnershipId: string;
}

export type ApiData<T> = T & { ok?: boolean; error?: string; stageChanged?: StageChange | null; undo?: QuickUndo | null; undoMove?: MoveUndo | null };

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
  /** Offer Undo on the success toast when the server recorded the press or the move. */
  undo?: boolean;
  /** The success toast worked out from the answer (bulk counts). */
  successFrom?: (data: Record<string, unknown>) => string;
  /** Offer Undo with your own way back (Approve, Pass, bulk moves); null when there's nothing to undo. */
  undoWith?: (data: Record<string, unknown>) => (() => void) | null;
}

export const UNDO_TOAST_MS = 10_000;

/** Show the toasts that were waiting, once each. */
function flushToasts(due: (() => void)[]) {
  due.splice(0).forEach((show) => show());
}

export function useSave() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [refreshing, startTransition] = useTransition();
  // Toasts waiting for the refresh to land.
  const afterRefresh = useRef<(() => void)[]>([]);
  useEffect(() => {
    if (!refreshing) flushToasts(afterRefresh.current);
  }, [refreshing]);
  useEffect(() => {
    const due = afterRefresh.current;
    return () => flushToasts(due);
  }, []);

  async function run<T = Record<string, unknown>>(
    fn: () => Promise<ApiResult<T>>,
    opts: RunOptions = {},
  ): Promise<ApiResult<T>> {
    setSaving(true);
    let r: ApiResult<T>;
    try {
      r = await fn();
    } catch (e) {
      r = { ok: false, status: 0, data: { error: (e as Error).message } as ApiData<T> };
    }

    if (r.ok) {
      const undo = opts.undo ? r.data.undo : null;
      const moveUndo = opts.undo && !undo ? r.data.undoMove : null;
      const custom = opts.undoWith?.(r.data as Record<string, unknown>) ?? null;
      const message = opts.successFrom ? opts.successFrom(r.data as Record<string, unknown>) : opts.success;
      const show = () => {
        if (moveUndo || custom) {
          toast(message ?? "Saved", {
            tone: "good",
            detail: r.data.stageChanged ? describeStageChange(r.data.stageChanged) : undefined,
            action: { label: "Undo", onClick: custom ?? (() => void undoVia(`/api/partnerships/${moveUndo!.partnershipId}/undo`, { transitionId: moveUndo!.transitionId })) },
            durationMs: UNDO_TOAST_MS,
          });
          return;
        }
        if (undo) {
          // One toast: what happened, the stage move it caused, and Undo.
          toast(message ?? "Saved", {
            tone: "good",
            detail: r.data.stageChanged ? describeStageChange(r.data.stageChanged) : undefined,
            action: { label: "Undo", onClick: () => void undoPress(undo) },
            durationMs: UNDO_TOAST_MS,
          });
        } else {
          if (message) toast(message, { tone: "good" });
          if (r.data.stageChanged) toast(describeStageChange(r.data.stageChanged));
        }
      };
      if (opts.refresh !== false) {
        afterRefresh.current.push(show);
        startTransition(() => router.refresh());
      } else show();
      setSaving(false);
    } else {
      setSaving(false);
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
    else if (r.status === 0 || r.status >= 500)
      // Nothing was changed (an undo is all or nothing), so it can simply be tried again.
      toast(r.data.error ?? "Couldn't undo it", { tone: "bad", action: { label: "Try again", onClick: () => void undoPress(u) } });
    else toast(r.data.error ?? "Couldn't undo it", { tone: "bad" });
    router.refresh();
  }

  /**
   * Any other Undo: post to its route, say what happened, refresh. The server
   * decides whether it can still be undone; a network failure can be retried.
   */
  async function undoVia(url: string, body: unknown, done = "Undone") {
    const r = await api<{ stage?: CmStage | null; message?: string }>(url, body).catch(
      () => ({ ok: false, status: 0, data: { error: "Couldn't reach the server" } }) as ApiResult<{ stage?: CmStage | null; message?: string }>,
    );
    // A bulk undo says how many it managed ("2 of 3 undone — the rest changed since").
    if (r.ok) toast(r.data.message ? `${done}: ${r.data.message}` : r.data.stage ? `${done} — back to ${stageLabel(r.data.stage)}` : done, { tone: "good" });
    else if (r.status === 0 || r.status >= 500) toast(r.data.error ?? "Couldn't undo it", { tone: "bad", action: { label: "Try again", onClick: () => void undoVia(url, body, done) } });
    else toast(r.data.error ?? "Couldn't undo it", { tone: "bad" });
    startTransition(() => router.refresh());
  }

  return { pending: saving || refreshing, run, undoVia };
}
