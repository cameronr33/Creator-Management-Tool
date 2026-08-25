import {
  resolveClient,
  getClients,
  getCampaigns,
  getTemplates,
  getApiKeys,
} from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { PageHeader, Card, SectionTitle, EmptyState, Badge } from "@/components/ui";
import { CampaignAdder, TemplateEditor, ApiKeyManager, GmailConnectCard } from "@/components/settings-forms";
import { gmailConfigured } from "@/lib/gmail";
import { getActiveGmailAccount } from "@/lib/gmail-sync";

export default async function SettingsPage() {
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) {
    return (
      <>
        <PageHeader title="Settings" />
        <div className="p-6">
          <EmptyState title="No client selected" />
        </div>
      </>
    );
  }

  const [clients, campaigns, templates, apiKeys, gmailAccount] = await Promise.all([
    getClients(),
    getCampaigns(client.id),
    getTemplates(client.id),
    getApiKeys(),
    getActiveGmailAccount(),
  ]);
  const defaultDmTemplate = templates.find((t) => t.isDefault && t.channel === "ig_dm") ?? null;
  const defaultEmailTemplate = templates.find((t) => t.isDefault && t.channel === "email") ?? null;

  return (
    <>
      <PageHeader title="Settings" subtitle={client.name} />
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <Card className="p-5">
          <SectionTitle>Clients</SectionTitle>
          <ul className="mt-3 flex flex-wrap gap-2">
            {clients.map((c) => (
              <li key={c.id}>
                <Badge tone={c.slug === client.slug ? "accent" : "neutral"}>{c.name}</Badge>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-faint">
            Client roster is shared with the analytics dashboard. Switch the active client from the sidebar.
          </p>
        </Card>

        <Card className="p-5">
          <SectionTitle>Campaigns · {client.name}</SectionTitle>
          <ul className="mt-3 mb-3 flex flex-wrap gap-2">
            {campaigns.length === 0 ? (
              <span className="text-sm text-text-faint">No campaigns yet.</span>
            ) : (
              campaigns.map((c) => (
                <li key={c.id}>
                  <Badge>{c.name}</Badge>
                </li>
              ))
            )}
          </ul>
          <CampaignAdder clientId={client.id} />
        </Card>

        <Card className="p-5">
          <SectionTitle>Default DM template</SectionTitle>
          <p className="mt-1 mb-3 text-xs text-text-faint">
            Rendered on the Outreach worklist and each creator&apos;s composer with {"{{name}}"} filled in.
          </p>
          <TemplateEditor clientId={client.id} channel="ig_dm" template={defaultDmTemplate} />
        </Card>

        <Card className="p-5">
          <SectionTitle>Default email template</SectionTitle>
          <p className="mt-1 mb-3 text-xs text-text-faint">
            Used when a creator has a business email — the worklist offers Email as a channel and
            pre-fills a mailto link with this subject and body.
          </p>
          <TemplateEditor clientId={client.id} channel="email" template={defaultEmailTemplate} />
        </Card>

        <Card className="p-5">
          <SectionTitle>Email sync</SectionTitle>
          <p className="mt-1 mb-3 text-xs text-text-faint">
            Tracks creator outreach happening over email: threads are matched to creators by
            business email, logged on their timelines, and stages advance automatically. Runs
            twice a day (plus Sync now). Tracking only — the app never sends mail. Replies only
            sync when the connected mailbox is on the thread, so keep it cc&apos;d on every message.
          </p>
          <GmailConnectCard
            configured={gmailConfigured()}
            account={
              gmailAccount
                ? {
                    email: gmailAccount.email,
                    connectedAt: gmailAccount.connectedAt.toLocaleDateString(),
                    lastSyncAt: gmailAccount.lastSyncAt
                      ? gmailAccount.lastSyncAt.toLocaleString()
                      : null,
                    lastSyncStatus: gmailAccount.lastSyncStatus,
                    lastSyncSummary:
                      (gmailAccount.lastSyncSummary as {
                        inserted?: number;
                        skipped?: number;
                        unmatched?: number;
                        stageChanges?: number;
                        messagesFetched?: number;
                      } | null) ?? null,
                  }
                : null
            }
          />
        </Card>

        <Card className="p-5">
          <SectionTitle>API keys</SectionTitle>
          <p className="mt-1 mb-3 text-xs text-text-faint">
            For the creator-research skill to push results to <code>/api/ingest/research</code>.
          </p>
          <ApiKeyManager keys={apiKeys} />
        </Card>
      </div>
    </>
  );
}
