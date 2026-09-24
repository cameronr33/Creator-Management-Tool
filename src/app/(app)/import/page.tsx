import { requireAgencyPage } from "@/lib/page-guards";
import type { Metadata } from "next";
import { resolveClient } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { resolveCampaign } from "@/lib/campaigns";
import { PageHeader, Card, CardHeader, EmptyState } from "@/components/ui";
import { CsvImport } from "@/components/csv-import";

export const metadata: Metadata = { title: "Import creators" };

export default async function ImportPage() {
  await requireAgencyPage();
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) {
    return (
      <>
        <PageHeader title="Import creators" />
        <div className="p-6">
          <EmptyState title="No client selected" hint="Pick a client in the sidebar first." />
        </div>
      </>
    );
  }
  const campaign = await resolveCampaign(client.id);

  return (
    <>
      <PageHeader
        title="Import creators"
        client={client.name}
        campaign={campaign?.name ?? null}
        help="A spreadsheet of names with a Campaign column is enough. Campaigns are matched ignoring capitals and created when they don't exist yet. You see exactly what will happen before anything is saved."
        helpAnchor="daily-loop"
      />
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <Card className="p-5">
          <CardHeader
            title="Upload a CSV"
            description="Export your sheet as CSV. Recognised columns: Name, Campaign, Instagram (a handle or link), Email, Content Pillar, Followers, Notes. The research CSV works too."
          />
          <div className="mt-4">
            <CsvImport defaultCampaign={campaign?.name ?? ""} />
          </div>
        </Card>
      </div>
    </>
  );
}
