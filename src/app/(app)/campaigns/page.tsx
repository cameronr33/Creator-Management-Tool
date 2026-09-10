import Link from "next/link";
import { resolveClient, getCampaigns, getCreatorRows } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { PageHeader, Card, EmptyState, StagePill } from "@/components/ui";
import { money } from "@/lib/format";
import { ACTIVE_STAGES, isTerminal } from "@/lib/stages";
import type { CmStage } from "@/lib/db/schema";

export default async function CampaignsPage() {
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) {
    return (
      <>
        <PageHeader title="Campaigns" />
        <div className="p-6">
          <EmptyState title="No client selected" />
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
      <PageHeader title="Campaigns" subtitle={`${campaigns.length} · ${client.name}`} />
      <div className="space-y-4 p-6">
        {campaigns.length === 0 ? (
          <EmptyState title="No campaigns yet" hint="Campaigns are created when you import or run research." />
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
                    <Stat label="Creators" value={members.length} />
                    <Stat label="Active" value={active.length} />
                    <Stat label="Agreed+" value={agreed.length} />
                    <Stat label="Committed" value={committed > 0 ? money(committed) : "—"} />
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {topStages.map(({ stage, n }) => (
                    <Link key={stage} href={`/creators?campaign=${c.id}&stage=${stage}`} className="flex items-center gap-1.5">
                      <StagePill stage={stage} />
                      <span className="text-xs tabular text-text-muted">{n}</span>
                    </Link>
                  ))}
                </div>
              </Card>
            );
          })
        )}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-text-faint">{label}</div>
      <div className="tabular text-lg font-semibold text-text">{value}</div>
    </div>
  );
}
