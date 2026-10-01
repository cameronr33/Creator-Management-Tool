import { statusNoteView } from "@/lib/status-note";
import { openPromise, promiseLine } from "@/lib/promises";
import { requireAgencyPage } from "@/lib/page-guards";
import { resolveClient, getCreatorRows, getOutreachStates } from "@/lib/queries";
import { scheduleEmailCheckForVisitor } from "@/lib/page-email-check";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { resolveCampaign } from "@/lib/campaigns";
import { PageHeader, EmptyState, Button } from "@/components/ui";
import { PipelineBoard, type BoardCard } from "@/components/pipeline-board";
import { MineToggle } from "@/components/mine-toggle";
import { getSelectedView } from "@/lib/view-cookie";
import { chipLabels, hiddenSummary, listTeammates, memberForUser, splitByView } from "@/lib/owners";
import { splitArchived } from "@/lib/archive-rules";
import { getLastInboundStoredAt } from "@/lib/archive";

export default async function PipelinePage() {
  const session = await requireAgencyPage();
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

  const [campaign, view, teammates] = await Promise.all([resolveCampaign(client.id), getSelectedView(), listTeammates()]);
  const meId = (await memberForUser(session.user))?.id ?? null;
  const labels = chipLabels(teammates);
  const team = teammates.map((t) => ({ ...t, label: labels.get(t.id) ?? "?" }));
  const everything = await getCreatorRows(client.id, { campaignId: campaign?.id, withOutreach: false });
  // Archived creators aren't on the board, nor in its counts (2026-09-29).
  const { active: all, archived } = splitArchived(everything, await getLastInboundStoredAt(everything.map((r) => r.partnershipId)));
  const archivedHere = splitByView(archived, view, meId).shown.length;
  const { shown: rows, hidden } = splitByView(all, view, meId);
  const hiddenLine = hiddenSummary(hidden);
  const outreach = await getOutreachStates(rows.map((r) => r.partnershipId));
  const cards: BoardCard[] = rows.map((r) => ({
    partnershipId: r.partnershipId,
    name: r.name,
    stage: r.stage,
    campaignName: r.campaignName,
    latest: r.activity.text,
    latestFromEmail: r.activity.fromEmail,
    statusNote: statusNoteView(r),
    latestAt: r.activity.at?.toISOString() ?? null,
    whoseTurn: r.activity.whoseTurn,
    photoUrl: r.photoUrl,
    clientApproval: r.clientApproval,
    owner: r.ownerId ? { id: r.ownerId, name: r.ownerName ?? "A teammate", label: labels.get(r.ownerId) ?? "?" } : null,
    hasOutbound: (outreach.get(r.partnershipId)?.totalOutbound ?? 0) > 0,
    promise: (() => {
      const p = openPromise(r);
      return p ? promiseLine(p) : null;
    })(),
  }));

  return (
    <>
      <PageHeader
        title="Pipeline"
        client={client.name}
        campaign={campaign?.name ?? null}
        subtitle={`${cards.length} creator${cards.length === 1 ? "" : "s"}${archivedHere ? ` · ${archivedHere} archived` : ""}${view === "mine" ? ` · yours and unassigned${hiddenLine ? ` (${hiddenLine})` : ""}` : ""}`}
        actions={<MineToggle view={view} />}
        help="One column per stage. Each card shows who looks after it, whose turn it is and the latest message. Move a card by dragging it, or from its ⋯ menu — which also logs a message, adds a note or archives. Hover a column name to see what that stage means; closing a deal asks who ended it and why."
        helpAnchor="stages"
      />
      <div className="p-6">
        {cards.length === 0 && all.length > 0 ? (
          <EmptyState title="Nothing of yours here" hint={`${hiddenLine ?? "Everyone's creators are hidden"} — switch to Everyone to see them.`} />
        ) : cards.length === 0 ? (
          <EmptyState
            title={campaign ? `No creators in ${campaign.name} yet` : "No creators yet"}
            hint="Import a CSV of creators, or add one by pasting their profile link."
            action={<div className="flex gap-2"><Button href="/import">Import CSV</Button><Button href="/creators/new" variant="primary">Add creator</Button></div>}
          />
        ) : (
          <PipelineBoard cards={cards} meId={meId} team={team} clientName={client.name} showCampaign={!campaign} />
        )}
      </div>
    </>
  );
}
