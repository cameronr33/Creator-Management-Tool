import { CheckEmailButton } from "@/components/check-email-button";
import { requireAgencyPage } from "@/lib/page-guards";
import { Plus, Mail } from "lucide-react";
import { scheduleEmailCheckForVisitor } from "@/lib/page-email-check";
import { resolveClient } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { getTodayData } from "@/lib/today-data";
import { PageHeader, EmptyState, Button, Callout } from "@/components/ui";
import { TodayList } from "@/components/today-list";
import { AToZStrip } from "@/components/a-to-z";
import { MineToggle } from "@/components/mine-toggle";
import { getActiveGmailAccount } from "@/lib/gmail-sync";
import { summarizeGmailHealth } from "@/lib/gmail-health";
import { resolveCampaign } from "@/lib/campaigns";
import { getSelectedView } from "@/lib/view-cookie";
import { chipLabels, listTeammates, memberForUser } from "@/lib/owners";

export default async function TodayPage() {
  const session = await requireAgencyPage();
  await scheduleEmailCheckForVisitor();
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) return <><PageHeader title="Today" /><div className="p-6"><EmptyState title="No clients to show" hint="Choose which clients to show in Settings." action={<Button href="/settings">Open settings</Button>} /></div></>;
  const [campaign, view] = await Promise.all([resolveCampaign(client.id), getSelectedView()]);
  const me = await memberForUser(session.user);
  const meId = me?.id ?? null;
  const [{ rows, stageCounts, hiddenSummary, totalCreators, snoozedCount }, account, teammates] = await Promise.all([
    getTodayData({ clientId: client.id, campaignId: campaign?.id, view, me: meId }),
    getActiveGmailAccount(),
    listTeammates(),
  ]);
  const labels = chipLabels(teammates);
  const team = teammates.map((t) => ({ ...t, label: labels.get(t.id) ?? "?" }));
  const health = summarizeGmailHealth(account);
  const toDo = rows.filter((r) => r.section !== "waiting" && r.section !== "snoozed").length;
  const waiting = rows.filter((r) => r.section === "waiting").length;
  const scope = view === "mine" ? ` · yours and unassigned${hiddenSummary ? ` (${hiddenSummary})` : ""}` : "";
  return <>
    <PageHeader title="Today" client={client.name} campaign={campaign?.name ?? null}
      subtitle={`${toDo ? `${toDo} thing${toDo === 1 ? "" : "s"} to do · ${waiting} waiting on others` : "Nothing to do right now"}${snoozedCount ? ` · ${snoozedCount} snoozed` : ""}${scope}`}
      help="Everyone who needs something from you, grouped by what to do next. Each row shows the campaign, the latest message and whose turn it is. Fix a stage with the menu on the right; the button under the name does the next step. Mine shows yours and unassigned ones."
      helpAnchor="daily-loop" actions={<><MineToggle view={view} /><Button href="/creators/new" variant="primary" icon={<Plus size={15} />}>Add creator</Button></>} />
    <div className="space-y-4 p-4 sm:p-6">
      <AToZStrip counts={stageCounts} />
      <Callout tone={health.tone} icon={<Mail size={16} />} title={health.label}
        actions={<>{account && <CheckEmailButton />}<Button size="sm" variant="ghost" href="/settings#email-sync">Email settings</Button></>}>
        {health.detail}
      </Callout>
      {rows.length === 0
        ? (totalCreators > 0
          ? <EmptyState title="All caught up" hint={`Nobody needs anything from you right now. Posted and closed deals don't show here.${hiddenSummary ? ` ${hiddenSummary} — switch to Everyone to see them.` : ""}`} />
          : <EmptyState title={campaign ? `No creators in ${campaign.name} yet` : "No creators yet"} hint="Add a creator or import a CSV to get started." action={<Button href="/import">Import CSV</Button>} />)
        : <TodayList rows={rows} meId={meId} team={team} showCampaign={!campaign} />}
    </div>
  </>;
}
