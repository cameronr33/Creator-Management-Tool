import { requireAgencyPage } from "@/lib/page-guards";
import type { Metadata } from "next";
import { resolveClient, getCampaigns } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { resolveCampaign } from "@/lib/campaigns";
import { PageHeader, EmptyState } from "@/components/ui";
import { AddCreatorForm } from "@/components/add-creator-form";

export const metadata: Metadata = { title: "Add creator" };

export default async function NewCreatorPage() {
  await requireAgencyPage();
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) {
    return (
      <>
        <PageHeader title="Add creator" />
        <div className="p-6">
          <EmptyState title="No client selected" hint="Pick a client in the sidebar first." />
        </div>
      </>
    );
  }

  const [campaigns, selected] = await Promise.all([getCampaigns(client.id), resolveCampaign(client.id)]);

  return (
    <>
      <PageHeader
        title="Add creator"
        client={client.name}
        back={{ href: "/creators", label: "Creators" }}
        help="For one creator at a time. Paste their profile link, auto-fill what you can, and pick the campaign. For a list, use Import CSV."
      />
      <div className="p-6">
        <AddCreatorForm
          clientId={client.id}
          clientName={client.name}
          campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
          defaultCampaignId={selected?.id ?? null}
        />
      </div>
    </>
  );
}
