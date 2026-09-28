import { requireAgencyPage } from "@/lib/page-guards";
import type { Metadata } from "next";
import { scheduleEmailCheckForVisitor } from "@/lib/page-email-check";
import { Plus, Upload } from "lucide-react";
import { resolveClient, getCampaigns, getCreatorRows } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { resolveCampaign } from "@/lib/campaigns";
import { PageHeader, EmptyState, Button } from "@/components/ui";
import { CreatorsFilterBar } from "@/components/creators-filter-bar";
import { CreatorsTable } from "@/components/creators-table";
import type { CmStage } from "@/lib/db/schema";
import { STAGES } from "@/lib/stages";

export const metadata: Metadata = { title: "Creators" };

export default async function CreatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stage?: string }>;
}) {
  await requireAgencyPage();
  await scheduleEmailCheckForVisitor();
  const sp = await searchParams;
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) {
    return (
      <>
        <PageHeader title="Creators" />
        <div className="p-6">
          <EmptyState title="No client selected" hint="Pick a client in the sidebar first." />
        </div>
      </>
    );
  }

  const [campaigns, campaign] = await Promise.all([getCampaigns(client.id), resolveCampaign(client.id)]);
  let rows = await getCreatorRows(client.id, {
    campaignId: campaign?.id,
    stage: STAGES.some((s) => s.value === sp.stage) ? (sp.stage as CmStage) : undefined,
  });
  const total = rows.length;
  const q = (sp.q ?? "").trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q) ||
        (r.contentPillar ?? "").toLowerCase().includes(q) ||
        (r.businessEmail ?? "").toLowerCase().includes(q),
    );
  }

  const addButton = (
    <Button href="/creators/new" variant="primary" icon={<Plus size={15} />}>
      Add creator
    </Button>
  );
  const importButton = (
    <Button href="/import" icon={<Upload size={15} />}>
      Import CSV
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Creators"
        client={client.name}
        campaign={campaign?.name ?? null}
        subtitle={rows.length === total ? `${total} creator${total === 1 ? "" : "s"}` : `${rows.length} of ${total} shown`}
        help="Everyone you're tracking. Tick creators to move them to a stage or another campaign, or to delete them. Open a creator for their conversation, deal, shipping and videos."
        actions={
          <>
            {importButton}
            {addButton}
          </>
        }
      >
        <CreatorsFilterBar />
      </PageHeader>
      <div className="p-4 sm:p-6">
        {rows.length === 0 ? (
          <EmptyState
            title={total === 0 ? (campaign ? `No creators in ${campaign.name} yet` : "No creators yet") : "No creators match"}
            hint={
              total === 0
                ? "Import a CSV with their names and a Campaign column, or add one by pasting their profile link."
                : "Try clearing the search or the stage filter."
            }
            action={
              total === 0 ? (
                <div className="flex gap-2">
                  {importButton}
                  {addButton}
                </div>
              ) : undefined
            }
          />
        ) : (
          <CreatorsTable
            rows={rows.map((r) => ({
              partnershipId: r.partnershipId,
              name: r.name,
              username: r.username,
              profileUrl: r.profileUrl,
              businessEmail: r.businessEmail,
              followers: r.followers,
              stage: r.stage,
              campaignName: r.campaignName,
              emailWhoseTurn: r.emailWhoseTurn,
              lastOutboundAt: r.lastOutboundAt ? r.lastOutboundAt.toISOString() : null,
              repliedAt: r.repliedAt ? r.repliedAt.toISOString() : null,
              photoUrl: r.photoUrl,
              clientApproval: r.clientApproval,
              standing: r.statusNote
                ? { text: r.statusNote, ours: true, at: r.statusNoteAt?.toISOString() ?? null }
                : { text: r.activity.text, ours: false, at: r.activity.at?.toISOString() ?? null },
              whoseTurn: r.activity.whoseTurn,
            }))}
            campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
            scopeName={campaign?.name ?? null}
          />
        )}
      </div>
    </>
  );
}
