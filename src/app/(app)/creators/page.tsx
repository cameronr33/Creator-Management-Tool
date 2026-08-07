import Link from "next/link";
import { ExternalLink, Mail, Plus } from "lucide-react";
import { resolveClient, getCampaigns, getCreatorRows } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { PageHeader, EmptyState, StagePill, Avatar, Badge } from "@/components/ui";
import { CreatorsFilterBar } from "@/components/creators-filter-bar";
import { compactNumber, relativeDays } from "@/lib/format";
import type { CmStage } from "@/lib/db/schema";

export default async function CreatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stage?: string; campaign?: string }>;
}) {
  const sp = await searchParams;
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) {
    return (
      <>
        <PageHeader title="Creators" />
        <div className="p-6">
          <EmptyState title="No client selected" hint="Add a client in Settings or run the import." />
        </div>
      </>
    );
  }

  const campaigns = await getCampaigns(client.id);
  let rows = await getCreatorRows(client.id, {
    campaignId: sp.campaign || undefined,
    stage: (sp.stage as CmStage) || undefined,
  });

  const q = (sp.q ?? "").trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q) ||
        (r.contentPillar ?? "").toLowerCase().includes(q),
    );
  }

  return (
    <>
      <PageHeader
        title="Creators"
        subtitle={`${rows.length} shown`}
        actions={
          <>
            <CreatorsFilterBar campaigns={campaigns} />
            <Link
              href="/creators/new"
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
            >
              <Plus size={15} /> Add creator
            </Link>
          </>
        }
      />
      <div className="p-6">
        {rows.length === 0 ? (
          <EmptyState
            title="No creators match"
            hint="Try clearing the filters, or add a creator by pasting their profile link."
            action={
              <Link
                href="/creators/new"
                className="mt-2 flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
              >
                <Plus size={15} /> Add creator
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-text-faint">
                  <th className="px-4 py-2.5 font-semibold">Creator</th>
                  <th className="px-4 py-2.5 font-semibold">Pillar</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Followers</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Avg views</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Max views</th>
                  <th className="px-4 py-2.5 font-semibold">Stage</th>
                  <th className="px-4 py-2.5 font-semibold">Last touch</th>
                  <th className="px-4 py-2.5 font-semibold">Campaign</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.partnershipId} className="group transition hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.name} />
                        <div className="min-w-0">
                          <Link
                            href={`/creators/${r.partnershipId}`}
                            className="font-medium text-text hover:text-accent"
                          >
                            {r.name}
                          </Link>
                          <div className="flex items-center gap-1.5 text-xs text-text-muted">
                            <a
                              href={r.profileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 hover:text-accent"
                            >
                              @{r.username}
                              <ExternalLink size={11} />
                            </a>
                            {r.businessEmail && (
                              <a href={`mailto:${r.businessEmail}`} className="hover:text-accent" title={r.businessEmail}>
                                <Mail size={11} />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">{r.contentPillar ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular">{compactNumber(r.followers)}</td>
                    <td className="px-4 py-2.5 text-right tabular">
                      <span className="inline-flex items-center gap-1">
                        {compactNumber(r.avgViews)}
                        {r.viewsSource === "apify" && (
                          <span title="Apify estimate — understates public Views">
                            <Badge tone="muted">est</Badge>
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular">{compactNumber(r.maxViews)}</td>
                    <td className="px-4 py-2.5">
                      <StagePill stage={r.stage} />
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {r.repliedAt ? (
                        <Badge tone="good">replied</Badge>
                      ) : r.lastOutboundAt ? (
                        <span title={`${r.followUpCount} follow-up(s)`}>{relativeDays(r.lastOutboundAt)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">{r.campaignName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
