"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import { toast } from "@/components/toast";

/** Check the mailbox now — from Today as well as Settings. */
export function CheckEmailButton() {
  const { pending, run } = useSave();
  const check = async () => {
    const r = await run(() => api<{ inserted?: number; stageChanges?: unknown[]; fetchErrors?: number; truncated?: boolean }>("/api/gmail/sync"), {});
    if (r.ok) {
      const partial = (r.data.fetchErrors ?? 0) > 0 || !!r.data.truncated;
      toast(partial ? "Email check incomplete — the next check continues" : "Email checked", {
        tone: partial ? "info" : "good",
        detail: `${r.data.inserted ?? 0} new message(s) · ${r.data.stageChanges?.length ?? 0} stage change(s)`,
      });
    }
  };
  return (
    <Button size="sm" icon={<RefreshCw size={13} />} onClick={check} pending={pending}>
      {pending ? "Checking…" : "Check email now"}
    </Button>
  );
}
