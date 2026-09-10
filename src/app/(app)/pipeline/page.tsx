import { resolveClient, getCreatorRows } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { PageHeader, EmptyState } from "@/components/ui";
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
          <EmptyState title="No client selected" />
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
      <PageHeader title="Pipeline" subtitle={`${client.name} · drag a card to move stage`} />
      <div className="p-6">
        {cards.length === 0 ? (
          <EmptyState title="No creators yet" hint="Run the import or add creators to see the board." />
        ) : (
          <PipelineBoard cards={cards} />
        )}
      </div>
    </>
  );
}
