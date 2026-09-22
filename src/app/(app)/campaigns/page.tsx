import Link from "next/link";
import { resolveClient, getCampaigns, getCreatorRows } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { PageHeader, Card, EmptyState, StagePill, Button } from "@/components/ui";
import { money } from "@/lib/format";
import { ACTIVE_STAGES, isTerminal } from "@/lib/stages";
import type { CmStage } from "@/lib/db/schema";
import { CampaignAdder } from "@/components/settings-forms";

export default async function CampaignsPage() {
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) {
    return (
      <>
        <PageHeader title="Campaigns" />
        <div className="p-6">
          <EmptyState title="No client selected" hint="Pick a client in the sidebar first." />
        </div>
      </>
    );
  }

  const [campaigns, rows] = await Promise.all([
    getCampaigns(client.id),
    getCreatorRows(client.id, { withOutreach: false }),
  ]);

  const byCampaign = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byCampaign.get(r.campaignId) ?? [];
    arr.push(r);
    byCampaign.set(r.campaignId, arr);
  }

  return (
    <>
      <PageHeader
        title="Campaigns"
        client={client.name}
        subtitle={`${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}`}
        help="A rollup per campaign: how many creators, how many are live, and what's been agreed. Click a stage to see those creators."
        helpAnchor="words"
        actions={<Button href="#new-campaign">Add a campaign</Button>}
      />
      <div className="space-y-4 p-6">
        <Card className="p-4" id="new-campaign"><CampaignAdder clientId={client.id} /></Card>
        {campaigns.length === 0 ? (
          <EmptyState
            title="No campaigns yet"
            hint="Create a campaign above, then add creators to it. Research imports can also create a campaign."
            action={<Button href="#new-campaign" variant="primary">Create a campaign</Button>}
          />
        ) : (
          campaigns.map((c) => {
            const members = byCampaign.get(c.id) ?? [];
            const active = members.filter((m) => !isTerminal(m.stage));
            const agreed = members.filter((m) =>
              ["agreed", "awaiting_address", "fulfilling", "content_pending", "posted", "completed"].includes(m.stage),
            );
            const committed = members.reduce((sum, m) => sum + (m.feeAmount ? Number(m.feeAmount) : 0), 0);
            const topStages = ACTIVE_STAGES.map((s) => ({
              stage: s.value as CmStage,
              n: members.filter((m) => m.stage === s.value).length,
            })).filter((x) => x.n > 0);

            return (
              <Card key={c.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-text">{c.name}</h2>
                    {c.description && <p className="text-sm text-text-muted">{c.description}</p>}
                  </div>
                  <div className="flex gap-6 text-right">
                    <Stat label="Creators" value={members.length} title="Everyone on this campaign, including closed deals" />
                    <Stat label="Active" value={active.length} title="Not closed" />
                    <Stat label="Agreed or later" value={agreed.length} title="Agreed, shipping, waiting on video, posted or completed" />
                    <Stat label="Recorded fees" value={committed > 0 ? money(committed) : "—"} title="All recorded fees, including proposals and closed deals. Payment itself is tracked in accounting." />
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {topStages.length === 0 ? (
                    <span className="text-xs text-text-muted">No active creators.</span>
                  ) : (
                    topStages.map(({ stage, n }) => (
                      <Link
                        key={stage}
                        href={`/creators?campaign=${c.id}&stage=${stage}`}
                        className="flex items-center gap-1.5 rounded-full transition hover:opacity-80"
                      >
                        <StagePill stage={stage} />
                        <span className="text-xs tabular text-text-muted">{n}</span>
                      </Link>
                    ))
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>
    </>
  );
}

function Stat({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div title={title}>
      <div className="text-xs text-text-muted">{label}</div>
      <div className="tabular text-lg font-semibold text-text">{value}</div>
    </div>
  );
}
