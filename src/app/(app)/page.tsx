import { requireAgencyPage } from "@/lib/page-guards";
import { Plus, Mail } from "lucide-react";
import { scheduleEmailCheckForVisitor } from "@/lib/page-email-check";
import { resolveClient } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { getTodayData } from "@/lib/today-data";
import { PageHeader, EmptyState, Button, Callout } from "@/components/ui";
import { TodayList } from "@/components/today-list";
import { AToZStrip } from "@/components/a-to-z";
import { getActiveGmailAccount } from "@/lib/gmail-sync";
import { summarizeGmailHealth } from "@/lib/gmail-health";
import { resolveCampaign } from "@/lib/campaigns";

export default async function TodayPage() {
  await requireAgencyPage();
  await scheduleEmailCheckForVisitor();
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) return <><PageHeader title="Today" /><div className="p-6"><EmptyState title="No clients to show" hint="Choose which clients to show in Settings." action={<Button href="/settings">Open settings</Button>} /></div></>;
  const campaign = await resolveCampaign(client.id);
  const [{ rows, stageCounts }, account] = await Promise.all([getTodayData(client.id, campaign?.id), getActiveGmailAccount()]);
  const health = summarizeGmailHealth(account);
  const toDo = rows.filter((r) => r.section !== "waiting").length;
  return <>
    <PageHeader title="Today" client={client.name} campaign={campaign?.name ?? null}
      subtitle={toDo ? `${toDo} thing${toDo === 1 ? "" : "s"} to do · ${rows.length - toDo} waiting on others` : "Nothing to do right now"}
      help="Everyone who needs something from you, grouped by what to do next. Each row shows the campaign, the latest message and whose turn it is. Fix a stage with the menu on the right; the button under the name does the next step."
      helpAnchor="daily-loop" actions={<Button href="/creators/new" variant="primary" icon={<Plus size={15} />}>Add creator</Button>} />
    <div className="space-y-4 p-4 sm:p-6">
      <AToZStrip counts={stageCounts} />
      <Callout tone={health.tone} icon={<Mail size={16} />} title={health.label}
        actions={<Button size="sm" href="/settings#email-sync">Email settings</Button>}>
        {health.detail}
      </Callout>
      {rows.length === 0
        ? <EmptyState title={campaign ? `Nothing to do in ${campaign.name}` : "Nothing to do"} hint="Add creators or import a CSV to get started. Posted and closed deals don't show here." action={<Button href="/import">Import CSV</Button>} />
        : <TodayList rows={rows} />}
    </div>
  </>;
}
