import { resolveClient, getCampaigns } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { PageHeader, EmptyState } from "@/components/ui";
import { AddCreatorForm } from "@/components/add-creator-form";

export default async function NewCreatorPage() {
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

  const campaigns = await getCampaigns(client.id);

  return (
    <>
      <PageHeader title="Add creator" subtitle={client.name} />
      <div className="p-6">
        <AddCreatorForm
          clientId={client.id}
          clientName={client.name}
          campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
        />
      </div>
    </>
  );
}
