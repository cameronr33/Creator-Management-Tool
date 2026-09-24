import { requireAgencyPage } from "@/lib/page-guards";
import { resolveClient, getCreatorRows } from "@/lib/queries";
import { scheduleEmailCheckForVisitor } from "@/lib/page-email-check";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { resolveCampaign } from "@/lib/campaigns";
import { PageHeader, EmptyState, Button } from "@/components/ui";
import { PipelineBoard, type BoardCard } from "@/components/pipeline-board";

export default async function PipelinePage() {
  await requireAgencyPage();
  await scheduleEmailCheckForVisitor();
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) {
    return (
      <>
        <PageHeader title="Pipeline" />
        <div className="p-6">
          <EmptyState title="No client selected" hint="Pick a client in the sidebar first." />
        </div>
      </>
    );
  }

  const campaign = await resolveCampaign(client.id);
  const rows = await getCreatorRows(client.id, { campaignId: campaign?.id, withOutreach: false });
  const cards: BoardCard[] = rows.map((r) => ({
    partnershipId: r.partnershipId,
    name: r.name,
    username: r.profileUrl ? r.username : null,
    followers: r.followers,
    stage: r.stage,
    campaignName: r.campaignName,
    latest: r.activity.text,
    latestFromEmail: r.activity.fromEmail,
    latestAt: r.activity.at?.toISOString() ?? null,
    whoseTurn: r.activity.whoseTurn,
    photoUrl: r.photoUrl,
    clientApproval: r.clientApproval,
  }));

  return (
    <>
      <PageHeader
        title="Pipeline"
        client={client.name}
        campaign={campaign?.name ?? null}
        subtitle={`${cards.length} creator${cards.length === 1 ? "" : "s"}`}
        help="One column per stage. Each card shows the campaign, the latest message and whose turn it is. Change the stage from the menu on the card, or drag it. Hover a column name to see what that stage means; closing a deal asks who ended it and why."
        helpAnchor="stages"
      />
      <div className="p-6">
        {cards.length === 0 ? (
          <EmptyState
            title={campaign ? `No creators in ${campaign.name} yet` : "No creators yet"}
            hint="Import a CSV of creators, or add one by pasting their profile link."
            action={<div className="flex gap-2"><Button href="/import">Import CSV</Button><Button href="/creators/new" variant="primary">Add creator</Button></div>}
          />
        ) : (
          <PipelineBoard cards={cards} />
        )}
      </div>
    </>
  );
}
