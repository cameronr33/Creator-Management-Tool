import { Plus, Mail } from "lucide-react";
import { resolveClient } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { getWorkspaceItems } from "@/lib/workspace-data";
import { PageHeader, EmptyState, Button, Callout } from "@/components/ui";
import { CreatorWorkspace } from "@/components/creator-workspace";
import { getActiveGmailAccount } from "@/lib/gmail-sync";
import { countOpenSuggestions } from "@/lib/email-suggestions";
import { summarizeGmailHealth } from "@/lib/gmail-health";

export default async function TodayPage() {
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) return <><PageHeader title="Today" /><div className="p-6"><EmptyState title="No clients to show" hint="Choose which clients to show in Settings." action={<Button href="/settings">Open settings</Button>} /></div></>;
  const [items, account, unmatched] = await Promise.all([getWorkspaceItems(client.id), getActiveGmailAccount(), countOpenSuggestions()]);
  const health = summarizeGmailHealth(account, unmatched);
  const active = items.filter(i => i.lane !== "closed").length;
  return <>
    <PageHeader title="Today" client={client.name} subtitle={`${active} active partnerships · your next steps in one place`}
      help="Review what needs your team, what is waiting on someone else, and which records need a closer look."
      helpAnchor="daily-loop" actions={<Button href="/creators/new" variant="primary" icon={<Plus size={15} />}>Add creator</Button>} />
    <div className="space-y-5 p-4 sm:p-6">
      <Callout tone={health.tone} icon={<Mail size={16} />} title={health.label}
        actions={<Button size="sm" href={unmatched ? "/review" : "/settings#email-sync"}>{unmatched ? `Review ${unmatched} senders` : "Email settings"}</Button>}>
        {health.detail}
      </Callout>
      <CreatorWorkspace items={items} />
    </div>
  </>;
}
