import { MineToggle } from "@/components/mine-toggle";
import { getSelectedView } from "@/lib/view-cookie";
import { chipLabels, emptyListMessage, listTeammates, listViewLine, memberForUser, splitForList } from "@/lib/owners";
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
import { splitArchived } from "@/lib/archive-rules";
import { getLastInboundStoredAt } from "@/lib/archive";
import Link from "next/link";

export const metadata: Metadata = { title: "Creators" };

export default async function CreatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stage?: string; archived?: string }>;
}) {
  const session = await requireAgencyPage();
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

  const [campaigns, campaign, view, teammates] = await Promise.all([getCampaigns(client.id), resolveCampaign(client.id), getSelectedView(), listTeammates()]);
  const meId = (await memberForUser(session.user))?.id ?? null;
  const labels = chipLabels(teammates);
  const team = teammates.map((t) => ({ ...t, label: labels.get(t.id) ?? "?" }));
  const inScope = await getCreatorRows(client.id, {
    campaignId: campaign?.id,
    stage: STAGES.some((s) => s.value === sp.stage) ? (sp.stage as CmStage) : undefined,
  });
  // The list is the active ones; Archived (2026-09-29) is its own view with Restore.
  const showArchived = sp.archived === "1";
  const split = splitArchived(inScope, await getLastInboundStoredAt(inScope.map((r) => r.partnershipId)));
  const scoped = showArchived ? split.archived : split.active;
  const otherCount = splitForList(showArchived ? split.active : split.archived, view, meId, null).rows.length;
  const q = (sp.q ?? "").trim().toLowerCase();
  const matches = q
    ? (r: (typeof scoped)[number]) =>
        r.name.toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q) ||
        (r.contentPillar ?? "").toLowerCase().includes(q) ||
        (r.businessEmail ?? "").toLowerCase().includes(q)
    : null;
  // The search looks through teammates' too, so their match is mentioned rather than lost.
  const { rows, total, hidden, hiddenAll } = splitForList(scoped, view, meId, matches);
  const hiddenLine = listViewLine({ searching: !!q, hiddenAll, hiddenMatching: hidden });
  const empty = emptyListMessage({ searching: !!q, total, hiddenAll, hiddenMatching: hidden });

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
        subtitle={
          <>
            {showArchived ? "Archived · " : ""}
            {`${rows.length === total ? `${total} creator${total === 1 ? "" : "s"}` : `${rows.length} of ${total} shown`}${view === "mine" ? ` · yours and unassigned${hiddenLine ? ` (${hiddenLine})` : ""}` : ""}`}
            {showArchived ? (
              <>
                {" · "}
                <Link href="/creators" className="underline hover:text-accent">Back to the list</Link>
              </>
            ) : otherCount ? (
              <>
                {" · "}
                <Link href="/creators?archived=1" className="underline hover:text-accent">{otherCount} archived</Link>
              </>
            ) : null}
          </>
        }
        help="Everyone you're tracking. Tick creators to move them to a stage or another campaign, or to delete them. Open a creator for their conversation, deal, shipping and videos."
        actions={
          <>
            <MineToggle view={view} />
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
            title={
              empty.kind === "teammates_match"
                ? "None of yours match"
                : empty.kind === "only_teammates"
                  ? "Nothing of yours here"
                  : empty.kind === "no_match"
                    ? "No creators match"
                    : campaign
                      ? `No creators in ${campaign.name} yet`
                      : "No creators yet"
            }
            hint={empty.hint}
            action={
              empty.kind === "empty" ? (
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
              owner: r.ownerId ? { id: r.ownerId, name: r.ownerName ?? "A teammate", label: labels.get(r.ownerId) ?? "?" } : null,
            }))}
            campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
            scopeName={campaign?.name ?? null}
            teammates={team}
            meId={meId}
            archivedView={showArchived}
          />
        )}
      </div>
    </>
  );
}
