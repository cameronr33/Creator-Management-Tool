import type { Metadata } from "next";
import {
  resolveClient,
  getClientsWithSettings,
  getCampaigns,
  getTemplates,
  getApiKeys,
} from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { PageHeader, Card, CardHeader, EmptyState, Badge, Callout, Button } from "@/components/ui";
import {
  CampaignAdder,
  TemplateEditor,
  ApiKeyManager,
  GmailConnectCard,
  GmailSyncStatus,
  type GmailAccountView,
} from "@/components/settings-forms";
import { ClientVisibility, FollowUpCadence } from "@/components/client-settings";
import { gmailConfigured } from "@/lib/gmail";
import { getActiveGmailAccount } from "@/lib/gmail-sync";
import { countOpenSuggestions } from "@/lib/email-suggestions";
import { DEFAULT_THRESHOLDS } from "@/lib/outreach";
import { getJobHealth } from "@/lib/job-runs";
import { summarizeGmailHealth, summarizeJobHealth } from "@/lib/gmail-health";

export const metadata: Metadata = { title: "Settings" };

const GMAIL_ERRORS: Record<string, string> = {
  invalid_state: "The Google sign-in didn't complete (state mismatch). Try Connect Gmail again.",
  no_refresh_token:
    "Google didn't return a refresh token. Remove Creator Manager under myaccount.google.com/permissions, then connect again.",
  exchange_failed:
    "Token exchange failed. Check GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and that the redirect URI matches this app's URL.",
  access_denied: "You cancelled the Google consent screen.",
};

function describeGmailResult(param: string | null): { tone: "good" | "bad"; text: string } | null {
  if (!param) return null;
  if (param === "connected") return { tone: "good", text: "Gmail connected. The first check backfills the last 90 days." };
  if (param.startsWith("error:")) {
    const code = param.slice("error:".length);
    return { tone: "bad", text: GMAIL_ERRORS[code] ?? `Gmail connection failed: ${code}` };
  }
  return null;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const gmailResult = describeGmailResult(typeof sp.gmail === "string" ? sp.gmail : null);
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) {
    return (
      <>
        <PageHeader title="Settings" />
        <div className="p-6">
          <EmptyState title="No client selected" hint="Pick a client in the sidebar first." />
        </div>
      </>
    );
  }

  const [clients, campaigns, templates, apiKeys, gmailAccount, openCount, jobHealth] =
    await Promise.all([
      getClientsWithSettings(),
      getCampaigns(client.id),
      getTemplates(client.id),
      getApiKeys(),
      getActiveGmailAccount(),
      countOpenSuggestions(),
      getJobHealth(),
    ]);
  const currentSettings = clients.find((c) => c.id === client.id) ?? null;
  const defaultDmTemplate = templates.find((t) => t.isDefault && t.channel === "ig_dm") ?? null;
  const defaultEmailTemplate = templates.find((t) => t.isDefault && t.channel === "email") ?? null;

  const accountView: GmailAccountView | null = gmailAccount
    ? {
        email: gmailAccount.email,
        connectedAt: gmailAccount.connectedAt.toLocaleDateString(),
        lastSyncAt: gmailAccount.lastSyncAt ? gmailAccount.lastSyncAt.toLocaleString() : null,
        health: summarizeGmailHealth(gmailAccount, openCount),
        lastSyncStatus: gmailAccount.lastSyncStatus,
        lastSyncSummary: (gmailAccount.lastSyncSummary as GmailAccountView["lastSyncSummary"]) ?? null,
      }
    : null;

  return (
    <>
      <PageHeader
        title="Settings"
        client={client.name}
        help="Set follow-up timing and templates for this client. Shared Gmail, automation, and access settings apply to every client."
        helpAnchor="email"
      />
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        {gmailResult && <Callout tone={gmailResult.tone}>{gmailResult.text}</Callout>}

        <Card id="email-sync" className="scroll-mt-4 p-5">
          <CardHeader
            title="Shared email tracking"
            description="One connected mailbox serves every client. Unmatched senders are reviewed in Needs review."
            actions={<Button href="/review" size="sm">Needs review{openCount > 0 ? ` (${openCount})` : ""}</Button>}
          />
          <div className="mt-3 space-y-3">
            {accountView ? (
              <GmailSyncStatus account={accountView} />
            ) : (
              <Callout
                tone="info"
                actions={
                  <Button size="sm" href="#gmail">
                    Connect it
                  </Button>
                }
              >
                No mailbox is connected yet, so email isn&apos;t being tracked. Connecting is a one-time admin step below.
              </Callout>
            )}
          </div>
        </Card>

        <GroupHeading>Client setup · {client.name}</GroupHeading>

        <Card id="cadence" className="scroll-mt-4 p-5">
          <CardHeader
            title="Follow-up timing"
            description={`When outreach and unanswered conversations need attention for ${client.name}. No-response closures require a teammate's review because email coverage may be incomplete.`}
          />
          <div className="mt-4">
            <FollowUpCadence
              clientId={client.id}
              clientName={client.name}
              current={currentSettings?.followUpThresholds ?? null}
              defaults={DEFAULT_THRESHOLDS}
            />
          </div>
        </Card>

        <Card id="campaigns" className="scroll-mt-4 p-5">
          <CardHeader title="Campaigns" description="A campaign is what creators are recruited for. Research runs create theirs automatically." />
          <ul className="mt-3 mb-4 flex flex-wrap gap-2">
            {campaigns.length === 0 ? (
              <span className="text-sm text-text-muted">No campaigns yet.</span>
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

        <Card id="templates" className="scroll-mt-4 p-5">
          <CardHeader
            title="Message templates"
            description="What the Outreach page pre-writes for each creator. One for Instagram DMs, one for email (used when a creator has an email address)."
          />
          <div className="mt-4 space-y-6">
            <div>
              <h3 className="mb-2 text-sm font-medium text-text">Instagram DM</h3>
              <TemplateEditor clientId={client.id} channel="ig_dm" template={defaultDmTemplate} />
            </div>
            <div className="border-t border-border pt-5">
              <h3 className="mb-2 text-sm font-medium text-text">Email</h3>
              <TemplateEditor clientId={client.id} channel="email" template={defaultEmailTemplate} />
            </div>
          </div>
        </Card>

        <GroupHeading>Admin · applies to every client</GroupHeading>

        <Card id="gmail" className="scroll-mt-4 p-5">
          <CardHeader
            title="Gmail connection"
            description="The shared mailbox the app reads (read-only) to track creator email. Keep it on cc for every creator email; replies on threads it isn't on are invisible."
          />
          <div className="mt-3">
            <GmailConnectCard configured={gmailConfigured()} account={accountView} />
          </div>
        </Card>

        <Card id="clients" className="scroll-mt-4 p-5">
          <CardHeader
            title="Clients shown in this tool"
            description="The client list is shared with the analytics dashboard. Un-ticking only hides a client here; switch between visible clients from the sidebar."
          />
          <div className="mt-3">
            <ClientVisibility clients={clients.map((c) => ({ ...c, isCurrent: c.id === client.id }))} />
          </div>
        </Card>

        <Card id="api-keys" className="scroll-mt-4 p-5">
          <CardHeader
            title="API keys"
            description="Lets the creator-research process on a teammate's machine push results straight into this tool."
          />
          <div className="mt-3">
            <ApiKeyManager keys={apiKeys} />
          </div>
        </Card>

        <Card id="automation" className="scroll-mt-4 p-5">
          <CardHeader
            title="Automation health"
            description="Every background job leaves a heartbeat. A job that hasn't completed within 1.5× its interval is flagged, so a dead worker is visible instead of silent."
          />
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {jobHealth.map((j) => {
              const health = summarizeJobHealth(j);
              const label =
                j.hoursSince == null
                  ? "never ran"
                  : j.hoursSince < 1
                    ? "ran under an hour ago"
                    : `ran ${Math.round(j.hoursSince)}h ago`;
              const summary = j.lastRun?.summary as Record<string, unknown> | null;
              return (
                <li key={j.job} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone={health.tone}>{health.label}</Badge>
                      <span className="font-medium text-text">{j.label}</span>
                      <span className="text-xs text-text-muted">
                        every {j.expectedEveryHours >= 24 ? `${j.expectedEveryHours / 24}d` : `${j.expectedEveryHours}h`}
                      </span>
                    </div>
                    <div className="truncate text-xs text-text-muted">
                      {label}
                      {j.lastRun?.error
                        ? ` — ${j.lastRun.error}`
                        : summary
                          ? ` — ${Object.entries(summary)
                              .map(([k, v]) => `${k} ${String(v)}`)
                              .join(", ")}`
                          : ""}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-2 text-sm font-semibold text-text">{children}</h2>;
}
