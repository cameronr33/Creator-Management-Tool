"use client";

import { Reply, Send } from "lucide-react";
import { Button } from "@/components/ui";
import { api, useSave } from "@/components/use-save";

/**
 * Instagram DMs can't be read automatically, so sending one is logged by
 * hand in one click. That starts the follow-up clock and moves a creator
 * from To contact to Contacted. Email on threads the mailbox is on needs no
 * button. Logging with an earlier date, or an email from your own inbox or a
 * call, is in the row's ⋯ menu. Either way the toast offers Undo.
 */
export function MessagedButton({
  partnershipId,
  name,
  hasOutbound,
  variant = "secondary",
}: {
  partnershipId: string;
  name: string;
  /** Whether an earlier message exists — decides first message vs follow-up. */
  hasOutbound: boolean;
  variant?: "primary" | "secondary";
}) {
  const { pending, run } = useSave();
  return (
    <Button
      size="sm"
      variant={variant}
      icon={<Send size={13} />}
      pending={pending}
      title="You sent them an Instagram DM just now — logs it on the timeline"
      onClick={() =>
        run(
          () =>
            api("/api/outreach", {
              partnershipId,
              direction: "outbound",
              channel: "ig_dm",
              kind: hasOutbound ? "follow_up" : "initial",
            }),
          { success: `Logged a DM to ${name}`, undo: true },
        )
      }
    >
      I messaged them
    </Button>
  );
}

/** The most common event after a send, reduced to one click. */
export function ReplyButton({ partnershipId, name }: { partnershipId: string; name: string }) {
  const { pending, run } = useSave();
  return (
    <Button
      size="sm"
      icon={<Reply size={13} />}
      pending={pending}
      title="They answered by DM just now — logs the reply on the timeline"
      onClick={() =>
        run(
          () =>
            api("/api/outreach", {
              partnershipId,
              direction: "inbound",
              channel: "ig_dm",
              kind: "reply",
            }),
          { success: `Logged ${name}'s reply`, undo: true },
        )
      }
    >
      They replied
    </Button>
  );
}
