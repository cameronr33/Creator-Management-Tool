import { resolveClient, getCreatorRows } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { PageHeader, EmptyState, Button } from "@/components/ui";
import { PipelineBoard, type BoardCard } from "@/components/pipeline-board";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string }>;
}) {
  const sp = await searchParams;
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

  const rows = await getCreatorRows(client.id, { campaignId: sp.campaign || undefined, withOutreach: false });
  const cards: BoardCard[] = rows.map((r) => ({
    partnershipId: r.partnershipId,
    name: r.name,
    username: r.username,
    followers: r.followers,
    stage: r.stage,
    agreementType: r.agreementType,
  }));

  return (
    <>
      <PageHeader
        title="Pipeline"
        client={client.name}
        subtitle={`${cards.length} creators`}
        help="One column per stage. Drag a card to move it, or use the arrow on the card. Hover a column name to see what that stage means; closing a deal asks who ended it and why."
        helpAnchor="stages"
      />
      <div className="p-6">
        {cards.length === 0 ? (
          <EmptyState
            title="No creators yet"
            hint="Add a creator by pasting their profile link, or import a research run."
            action={<Button href="/creators/new" variant="primary">Add creator</Button>}
          />
        ) : (
          <PipelineBoard cards={cards} />
        )}
      </div>
    </>
  );
}
