"use client";

import { Reply } from "lucide-react";
import { Button } from "@/components/ui";
import { api, useSave } from "@/components/use-save";

/** The most common event after a send, reduced to one click. */
export function ReplyButton({ partnershipId, name }: { partnershipId: string; name: string }) {
  const { pending, run } = useSave();
  return (
    <Button
      size="sm"
      icon={<Reply size={13} />}
      pending={pending}
      title="They answered — logs the reply on the timeline"
      onClick={() =>
        run(
          () =>
            api("/api/outreach", {
              partnershipId,
              direction: "inbound",
              channel: "ig_dm",
              kind: "reply",
            }),
          { success: `${name} marked as replied` },
        )
      }
    >
      They replied
    </Button>
  );
}
