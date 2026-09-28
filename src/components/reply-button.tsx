"use client";

import { useState } from "react";
import { CalendarClock, Reply, Send } from "lucide-react";
import { Button, IconButton } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import { LogMessagePanel } from "@/components/log-message";

/**
 * Instagram DMs can't be read automatically, so sending one is logged by
 * hand in one click. That starts the follow-up clock and moves a creator
 * from To contact to Contacted. Email on threads the mailbox is on needs no
 * button. The small calendar button logs it with a date, or as an email from
 * your own inbox or a call. Either way the toast offers Undo.
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
  const [more, setMore] = useState(false);
  if (more) return <LogMessagePanel partnershipId={partnershipId} name={name} direction="outbound" hasOutbound={hasOutbound} onClose={() => setMore(false)} />;
  return (
    <span className="inline-flex items-center gap-0.5">
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
      <IconButton label="Log it with a date, or as an email or a call" icon={<CalendarClock size={13} />} onClick={() => setMore(true)} />
    </span>
  );
}

/** The most common event after a send, reduced to one click (the calendar button: a date, or email / call). */
export function ReplyButton({ partnershipId, name }: { partnershipId: string; name: string }) {
  const { pending, run } = useSave();
  const [more, setMore] = useState(false);
  if (more) return <LogMessagePanel partnershipId={partnershipId} name={name} direction="inbound" hasOutbound onClose={() => setMore(false)} />;
  return (
    <span className="inline-flex items-center gap-0.5">
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
      <IconButton label="Log their reply with a date, or as an email or a call" icon={<CalendarClock size={13} />} onClick={() => setMore(true)} />
    </span>
  );
}
