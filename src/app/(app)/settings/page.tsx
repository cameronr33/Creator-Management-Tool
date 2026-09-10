import {
  resolveClient,
  getClientsWithSettings,
  getCampaigns,
  getTemplates,
  getApiKeys,
} from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { PageHeader, Card, SectionTitle, EmptyState, Badge } from "@/components/ui";
import { CampaignAdder, TemplateEditor, ApiKeyManager, GmailConnectCard } from "@/components/settings-forms";
import { EmailSuggestions } from "@/components/email-suggestions";
import { ClientVisibility, FollowUpCadence } from "@/components/client-settings";
import { gmailConfigured } from "@/lib/gmail";
import { getActiveGmailAccount } from "@/lib/gmail-sync";
import { listOpenSuggestions, getAllCreatorRefs } from "@/lib/email-suggestions";
import { DEFAULT_THRESHOLDS } from "@/lib/outreach";
import { getJobHealth } from "@/lib/job-runs";

const GMAIL_ERRORS: Record<string, string> = {
  invalid_state: "The Google sign-in didn't complete (state mismatch). Try Connect Gmail again.",
  no_refresh_token:
    "Google didn't return a refresh token. Remove Creator Manager under myaccount.google.com/permissions, then connect again.",
  exchange_failed:
    "Token exchange failed. Check GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and that the redirect URI matches this app's URL.",
  access_denied: "You cancelled the Google consent screen.",
};

function describeGmailResult(param: string | null): { tone: "ok" | "error"; text: string } | null {
  if (!param) return null;
  if (param === "connected") return { tone: "ok", text: "Gmail connected. The first sync backfills the last 90 days." };
  if (param.startsWith("error:")) {
    const code = param.slice("error:".length);
    return { tone: "error", text: GMAIL_ERRORS[code] ?? `Gmail connection failed: ${code}` };
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
          <EmptyState title="No client selected" />
        </div>
      </>
    );
  }

  const [clients, campaigns, templates, apiKeys, gmailAccount, suggestions, creatorRefs, jobHealth] =
    await Promise.all([
      getClientsWithSettings(),
      getCampaigns(client.id),
      getTemplates(client.id),
      getApiKeys(),
      getActiveGmailAccount(),
      listOpenSuggestions(),
      getAllCreatorRefs(),
      getJobHealth(),
    ]);
  const currentSettings = clients.find((c) => c.id === client.id) ?? null;
  const defaultDmTemplate = templates.find((t) => t.isDefault && t.channel === "ig_dm") ?? null;
  const defaultEmailTemplate = templates.find((t) => t.isDefault && t.channel === "email") ?? null;

  return (
    <>
      <PageHeader title="Settings" subtitle={client.name} />
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <Card className="p-5">
          <SectionTitle>Clients</SectionTitle>
          <p className="mt-1 mb-3 text-xs text-text-faint">
            The roster is shared with the analytics dashboard; unticking a client only hides it from
            this tool. Switch the active client from the sidebar.
          </p>
          <ClientVisibility
            clients={clients.map((c) => ({ ...c, isCurrent: c.id === client.id }))}
          />
          <div className="mt-4 border-t border-border pt-4">
            <FollowUpCadence
              clientId={client.id}
              clientName={client.name}
              current={currentSettings?.followUpThresholds ?? null}
              defaults={DEFAULT_THRESHOLDS}
            />
          </div>
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
          <SectionTitle>Automation health</SectionTitle>
          <p className="mt-1 mb-3 text-xs text-text-faint">
            Every background loop leaves a heartbeat. A loop that hasn&apos;t completed within 1.5× its
            interval is flagged — a dead cron worker is otherwise invisible.
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {jobHealth.map((j) => {
              const tone = j.failing ? "bad" : j.overdue ? "warn" : "good";
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
                      <Badge tone={tone}>{j.failing ? "failing" : j.overdue ? "overdue" : j.lastRun?.status ?? "—"}</Badge>
                      <span className="font-medium text-text">{j.label}</span>
                      <span className="text-xs text-text-faint">every {j.expectedEveryHours >= 24 ? `${j.expectedEveryHours / 24}d` : `${j.expectedEveryHours}h`}</span>
                    </div>
                    <div className="truncate text-xs text-text-muted">
                      {label}
                      {j.lastRun?.error ? ` — ${j.lastRun.error}` : summary ? ` — ${Object.entries(summary).map(([k, v]) => `${k} ${String(v)}`).join(", ")}` : ""}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="p-5">
          <SectionTitle>Email sync</SectionTitle>
          {gmailResult && (
            <p
              className={`mt-2 rounded-lg border px-3 py-2 text-sm ${
                gmailResult.tone === "ok"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {gmailResult.text}
            </p>
          )}
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
                        suggestionsOpen?: number;
                        windowDays?: number;
                      } | null) ?? null,
                  }
                : null
            }
          />
          {gmailAccount && (
            <div className="mt-4 border-t border-border pt-4">
              <EmailSuggestions
                suggestions={suggestions.map((s) => ({
                  id: s.id,
                  email: s.email,
                  displayName: s.displayName,
                  messageCount: s.messageCount,
                  lastSeenAt: s.lastSeenAt ? s.lastSeenAt.toLocaleDateString() : null,
                  sampleSubject: s.sampleSubject,
                  suggestedCreatorId: s.suggestedCreatorId,
                  suggestedCreatorName: s.suggestedCreatorName,
                }))}
                creators={creatorRefs.map((c) => ({ id: c.id, name: c.name, clientName: c.clientName }))}
              />
            </div>
          )}
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
