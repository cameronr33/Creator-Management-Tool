"use client";

import { UserPlus } from "lucide-react";
import { ChipButton, Field, OwnerChip, Select } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import { toast } from "@/components/toast";

/** A deal's owner as the client components get it: id, full name, chip label. */
export interface OwnerInfo {
  id: string;
  name: string;
  label: string;
}

export interface TeammateOption {
  id: string;
  name: string;
}

/**
 * The owner chip, or — when nobody has it — a light "Take it" chip that makes
 * it yours. If someone took it a moment before you, it says so.
 */
export function OwnerSlot({ partnershipId, owner, meId }: { partnershipId: string; owner: OwnerInfo | null; meId: string | null }) {
  const { pending, run } = useSave();
  if (owner) return <OwnerChip label={owner.label} name={owner.name} mine={owner.id === meId} />;
  return (
    <ChipButton
      disabled={pending}
      title="Nobody has this one — make it yours"
      icon={<UserPlus size={11} aria-hidden />}
      onClick={async () => {
        const r = await run(() => api<{ taken?: number }>("/api/partnerships/bulk", { action: "take", ids: [partnershipId] }));
        if (r.ok) toast(r.data.taken ? "It's yours" : "Someone took it a moment ago", { tone: r.data.taken ? "good" : "info" });
      }}
    >
      Take it
    </ChipButton>
  );
}

/** The owner on the creator page: pick a teammate, or nobody. */
export function OwnerPicker({ partnershipId, ownerId, teammates, meId }: { partnershipId: string; ownerId: string | null; teammates: TeammateOption[]; meId: string | null }) {
  const { pending, run } = useSave();
  return (
    <Field label="Owner">
      <Select
        compact
        className="w-48"
        value={ownerId ?? ""}
        disabled={pending}
        onChange={(e) => {
          const to = e.target.value || null;
          const who = to ? (to === meId ? "you" : (teammates.find((t) => t.id === to)?.name.split(" ")[0] ?? "them")) : null;
          run(() => api("/api/partnerships/bulk", { action: "set_owner", ids: [partnershipId], ownerId: to }), { success: who ? `Assigned to ${who}` : "Unassigned" });
        }}
      >
        <option value="">Nobody yet</option>
        {teammates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.id === meId ? `${t.name} (you)` : t.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
