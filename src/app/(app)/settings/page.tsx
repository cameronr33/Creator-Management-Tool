import {
  resolveClient,
  getClients,
  getCampaigns,
  getTemplates,
  getApiKeys,
} from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { PageHeader, Card, SectionTitle, EmptyState, Badge } from "@/components/ui";
import { CampaignAdder, TemplateEditor, ApiKeyManager } from "@/components/settings-forms";

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

  const [clients, campaigns, templates, apiKeys] = await Promise.all([
    getClients(),
    getCampaigns(client.id),
    getTemplates(client.id),
    getApiKeys(),
  ]);
  const defaultTemplate = templates.find((t) => t.isDefault) ?? null;

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
          <SectionTitle>Default outreach template</SectionTitle>
          <p className="mt-1 mb-3 text-xs text-text-faint">
            Rendered on the Outreach worklist and each creator&apos;s composer with {"{{name}}"} filled in.
          </p>
          <TemplateEditor clientId={client.id} template={defaultTemplate} />
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
