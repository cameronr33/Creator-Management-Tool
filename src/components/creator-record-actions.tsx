"use client";

import { useRouter } from "next/navigation";
import { Trash2, UserMinus } from "lucide-react";
import { FieldGroup } from "@/components/ui";
import { ChoiceMenu } from "@/components/menu";
import { ConfirmButton } from "@/components/confirm-button";
import { api, useSave } from "@/components/use-save";
import { toast } from "@/components/toast";

/** Move this partnership to another campaign of the same client. */
export function CampaignPicker({
  partnershipId,
  campaignId,
  campaigns,
}: {
  partnershipId: string;
  campaignId: string;
  campaigns: { id: string; name: string }[];
}) {
  const { pending, run } = useSave();
  if (campaigns.length < 2) return null;
  return (
    <FieldGroup label="Campaign" inline>
      <ChoiceMenu<string>
        label="Campaign"
        className="w-48"
        value={campaignId}
        pending={pending}
        options={campaigns.map((cp) => ({ value: cp.id, label: cp.name }))}
        onChoose={async (to) => {
          const name = campaigns.find((cp) => cp.id === to)?.name ?? "that campaign";
          const r = await run(() => api<{ moved?: number; skipped?: number }>("/api/partnerships/bulk", { action: "set_campaign", ids: [partnershipId], campaignId: to }));
          if (r.ok) toast(r.data.moved ? `Moved to ${name}` : `Already in ${name} — open them there`, { tone: r.data.moved ? "good" : "bad" });
        }}
      />
    </FieldGroup>
  );
}

/**
 * Remove from this campaign, or delete the creator everywhere. Both say
 * exactly what goes, and both are final.
 */
export function DangerZone({
  partnershipId,
  creatorId,
  name,
  campaignName,
  otherCampaigns,
}: {
  partnershipId: string;
  creatorId: string;
  name: string;
  campaignName: string;
  /** Names of the other campaigns this creator is in. */
  otherCampaigns: string[];
}) {
  const router = useRouter();
  const { pending, run } = useSave();
  const last = otherCampaigns.length === 0;
  return (
    <div className="flex flex-wrap gap-3">
      <ConfirmButton
        label={`Remove from ${campaignName}`}
        icon={<UserMinus size={13} />}
        pending={pending}
        question={
          last
            ? `${campaignName} is the only campaign ${name} is in, so this deletes ${name} completely — conversation, shipping and videos. This can't be undone.`
            : `Remove ${name} from ${campaignName}? Their conversation, shipping and videos for ${campaignName} go; they stay in ${otherCampaigns.join(", ")}. This can't be undone.`
        }
        confirmLabel="Remove"
        onConfirm={async () => {
          const r = await run(() => api("/api/partnerships/bulk", { action: "delete", ids: [partnershipId] }), {
            success: last ? `${name} deleted` : `${name} removed from ${campaignName}`,
            refresh: false,
          });
          if (r.ok) router.push("/creators");
        }}
      />
      {!last && (
        <ConfirmButton
          label="Delete everywhere"
          icon={<Trash2 size={13} />}
          pending={pending}
          question={`Delete ${name} from every campaign (${[campaignName, ...otherCampaigns].join(", ")}), with all their conversations, shipping and videos? This can't be undone.`}
          confirmLabel="Delete"
          onConfirm={async () => {
            const r = await run(() => api(`/api/creators/${creatorId}`, undefined, "DELETE"), { success: `${name} deleted`, refresh: false });
            if (r.ok) router.push("/creators");
          }}
        />
      )}
    </div>
  );
}
