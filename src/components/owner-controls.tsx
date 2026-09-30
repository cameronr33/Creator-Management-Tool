"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Settings2, UserMinus, UserPlus, UserRound } from "lucide-react";
import { DashedChip, Field, OwnerChip, Select } from "@/components/ui";
import { Menu, MenuItem, MenuLabel } from "@/components/menu";
import { api } from "@/components/use-save";
import { toast } from "@/components/toast";

/** A deal's owner as the client components get it: id, full name, chip label. */
export interface OwnerInfo {
  id: string;
  name: string;
  label: string;
}

/** Someone on the team, as the pickers get them. Switched-off teammates keep their chip but aren't offered. */
export interface TeammateOption {
  id: string;
  name: string;
  label: string;
  active: boolean;
}

type Prior = { id: string; ownerId: string | null };

const firstName = (name: string) => name.split(" ")[0];

/**
 * The toast after an owner change, with Undo (run-through, 2026-09-29): it
 * puts back who owned each deal before — only where nobody changed it since.
 */
export function ownerToast(message: string, prior: Prior[], setTo: string | null, refresh: () => void) {
  toast(message, {
    tone: "good",
    durationMs: 10_000,
    action: prior.length
      ? {
          label: "Undo",
          onClick: async () => {
            const r = await api<{ restored?: number }>("/api/partnerships/bulk", { action: "restore_owner", ids: prior.map((p) => p.id), prior, expected: setTo }).catch(() => null);
            if (r?.ok) toast(r.data.restored ? "Put back as it was" : "It was changed again since — nothing to undo", { tone: r.data.restored ? "good" : "info" });
            else toast(r?.data.error ?? "Couldn't undo it", { tone: "bad" });
            refresh();
          },
        }
      : undefined,
  });
}

/**
 * The owner chip, or — when nobody has it — a dashed "Take it" chip. Either
 * opens a menu: take it (or make it yours), assign it to a teammate,
 * unassign it, or manage the team. Every change can be undone from its toast.
 */
export function OwnerMenu({
  partnershipId,
  name,
  owner,
  meId,
  team,
}: {
  partnershipId: string;
  name: string;
  owner: OwnerInfo | null;
  meId: string | null;
  team: TeammateOption[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const refresh = () => router.refresh();
  const mine = !!owner && owner.id === meId;

  const change = async (to: string | null) => {
    setPending(true);
    const taking = to !== null && to === meId && !owner;
    const r = await api<{ prior?: Prior[]; taken?: number }>(
      "/api/partnerships/bulk",
      taking ? { action: "take", ids: [partnershipId] } : { action: "set_owner", ids: [partnershipId], ownerId: to },
    ).catch(() => null);
    setPending(false);
    if (!r?.ok) {
      toast(r?.data.error ?? "Couldn't change the owner", { tone: "bad" });
      return;
    }
    if (taking && !r.data.taken) {
      toast("Someone took it a moment ago", { tone: "info" });
      refresh();
      return;
    }
    const who = to === null ? null : to === meId ? "you" : firstName(team.find((t) => t.id === to)?.name ?? "them");
    ownerToast(who === "you" ? "It's yours" : who ? `Assigned to ${who}` : "Unassigned", r.data.prior ?? [], to, refresh);
    refresh();
  };

  const others = team.filter((t) => t.active && t.id !== owner?.id && t.id !== meId);
  return (
    <Menu
      label={owner ? `${mine ? "Yours" : `${owner.name}'s`} — change the owner` : `Nobody has ${name} — take it or assign it`}
      align="start"
      triggerClassName="relative inline-flex shrink-0 rounded-full before:absolute before:-inset-1 before:rounded-full before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
      trigger={owner ? <OwnerChip label={owner.label} name={owner.name} mine={mine} /> : <DashedChip icon={<UserPlus size={11} aria-hidden />}>Take it</DashedChip>}
    >
      {!mine && meId && (
        <MenuItem icon={<UserPlus size={14} />} disabled={pending} onSelect={() => change(meId)}>
          {owner ? "Make it mine" : "Take it"}
        </MenuItem>
      )}
      {others.length > 0 && <MenuLabel>Assign to</MenuLabel>}
      {others.map((t) => (
        <MenuItem key={t.id} icon={<UserRound size={14} />} disabled={pending} onSelect={() => change(t.id)}>
          {t.name}
        </MenuItem>
      ))}
      {owner && (
        <>
          <MenuLabel />
          <MenuItem icon={<UserMinus size={14} />} disabled={pending} onSelect={() => change(null)}>
            Unassign
          </MenuItem>
        </>
      )}
      <MenuLabel />
      <MenuItem icon={<Settings2 size={14} />} onSelect={() => router.push("/settings#team")}>
        Manage the team…
      </MenuItem>
    </Menu>
  );
}

/** The owner on the creator page: pick a teammate, or nobody. The toast has Undo. */
export function OwnerPicker({ partnershipId, ownerId, teammates, meId }: { partnershipId: string; ownerId: string | null; teammates: TeammateOption[]; meId: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  // Switched-off teammates aren't offered — unless they're the owner now.
  const options = teammates.filter((t) => t.active || t.id === ownerId);
  return (
    <Field label="Owner">
      <Select
        compact
        className="w-48"
        value={ownerId ?? ""}
        disabled={pending}
        onChange={async (e) => {
          const to = e.target.value || null;
          setPending(true);
          const r = await api<{ prior?: Prior[] }>("/api/partnerships/bulk", { action: "set_owner", ids: [partnershipId], ownerId: to }).catch(() => null);
          setPending(false);
          if (!r?.ok) {
            toast(r?.data.error ?? "Couldn't change the owner", { tone: "bad" });
            return;
          }
          const who = to ? (to === meId ? "you" : firstName(teammates.find((t) => t.id === to)?.name ?? "them")) : null;
          ownerToast(who ? `Assigned to ${who}` : "Unassigned", r.data.prior ?? [], to, () => router.refresh());
          router.refresh();
        }}
      >
        <option value="">Nobody yet</option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.id === meId ? `${t.name} (you)` : t.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
