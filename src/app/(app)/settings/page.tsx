import { requireAgencyPage } from "@/lib/page-guards";
import type { Metadata } from "next";
import { resolveClient, getClientsWithSettings, getCampaigns } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { PageHeader, Card, CardHeader, EmptyState, Callout, Button } from "@/components/ui";
import {
  CampaignAdder,
  CampaignManager,
  GmailConnectCard,
  GmailSyncStatus,
  TeamAddressesEditor,
  type GmailAccountView,
} from "@/components/settings-forms";
import { ClientVisibility, FollowUpCadence } from "@/components/client-settings";
import { gmailConfigured } from "@/lib/gmail";
import { getActiveGmailAccount, getEmailCoverage } from "@/lib/gmail-sync";
import { emailAutomoveOn, emailMoveStats } from "@/lib/email-status";
import { getCampaignCounts } from "@/lib/queries";
import { DEFAULT_THRESHOLDS } from "@/lib/outreach";
import { summarizeGmailHealth } from "@/lib/gmail-health";
import { listClientUsers } from "@/lib/client-users";
import { ClientTeam } from "@/components/client-team";
import { TeamSettings } from "@/components/team-settings";
import { listTeamForSettings, memberForUser } from "@/lib/owners";

export const metadata: Metadata = { title: "Settings" };

const GMAIL_ERRORS: Record<string, string> = {
  invalid_state: "The Google sign-in didn't finish. Try Connect a Google mailbox again.",
  no_refresh_token:
    "Google didn't return a refresh token. Remove Creator Manager under myaccount.google.com/permissions, then connect again.",
  exchange_failed:
    "Token exchange failed. Check GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and that the redirect URI matches this app's URL.",
  access_denied: "You cancelled the Google consent screen.",
};

function describeGmailResult(param: string | null): { tone: "good" | "bad"; text: string } | null {
  if (!param) return null;
  if (param === "connected") return { tone: "good", text: "Mailbox connected. The first check looks through each creator's last 6 months of email." };
  if (param.startsWith("error:")) {
    const code = param.slice("error:".length);
    return { tone: "bad", text: GMAIL_ERRORS[code] ?? `The mailbox didn't connect (${code}). Try again.` };
  }
  return null;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAgencyPage();
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

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [clients, campaigns, gmailAccount, coverage, moveStats] = await Promise.all([
    getClientsWithSettings(),
    getCampaigns(client.id),
    getActiveGmailAccount(),
    getEmailCoverage(),
    emailMoveStats(monthStart),
  ]);
  const [counts, clientPeople, myMember] = await Promise.all([getCampaignCounts(client.id), listClientUsers(client.id), memberForUser(session.user)]);
  const teamMembers = await listTeamForSettings();
  const readingOn = !!process.env.ANTHROPIC_API_KEY;
  const automove = emailAutomoveOn();
  const currentSettings = clients.find((c) => c.id === client.id) ?? null;

  const accountView: GmailAccountView | null = gmailAccount
    ? {
        email: gmailAccount.email,
        connectedAt: gmailAccount.connectedAt.toLocaleDateString(),
        lastSyncAt: gmailAccount.lastSyncAt ? gmailAccount.lastSyncAt.toLocaleString() : null,
        health: summarizeGmailHealth(gmailAccount),
        lastSyncStatus: gmailAccount.lastSyncStatus,
        lastSyncSummary: (gmailAccount.lastSyncSummary as GmailAccountView["lastSyncSummary"]) ?? null,
      }
    : null;

  return (
    <>
      <PageHeader
        title="Settings"
        client={client.name}
        help="Follow-up timing and campaigns for this client. The mailbox connection and which clients show apply to every client."
        helpAnchor="email"
      />
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        {gmailResult && <Callout tone={gmailResult.tone}>{gmailResult.text}</Callout>}

        <Card id="email-sync" className="scroll-mt-4 p-5">
          <CardHeader
            title="Email tracking"
            description="One connected mailbox serves every client. Only the email addresses saved on creators are searched — nothing else in the mailbox is read or stored."
          />
          <div className="mt-3 space-y-3">
            {accountView ? (
              <>
                <GmailSyncStatus account={accountView} />
                <p className="text-xs text-text-muted">
                  {readingOn
                    ? `Reading the latest email: on — after each check, new mail is read for a one-line summary and whose turn it is. Stage moves from email: ${automove ? "on" : "off (summaries only)"}${automove ? ` · ${moveStats.moves} this month · ${moveStats.undone} undone` : ""}.`
                    : "Reading the latest email is off on this server."}
                </p>
                <TeamAddressesEditor entries={gmailAccount?.teamAddresses ?? []} />
                {coverage.searchedNoMail.length > 0 && (
                  <Callout tone="info" title="No email found yet for these addresses">
                    The mailbox was searched for them and nothing turned up. Check the spelling on the creator, or add the
                    address they actually write from. Creators you only message on Instagram are fine to leave.
                    <ul className="mt-1.5 list-disc pl-4">
                      {coverage.searchedNoMail.map((c) => (
                        <li key={c.address}>
                          {c.creator} · <span className="break-all">{c.address}</span>
                        </li>
                      ))}
                    </ul>
                  </Callout>
                )}
                {coverage.shared.length > 0 && (
                  <Callout tone="warn" title="Addresses saved on more than one creator">
                    Email from these addresses can only be filed on one of them. Remove the address from the creator it
                    doesn&apos;t belong to.
                    <ul className="mt-1.5 list-disc pl-4">
                      {coverage.shared.map((c) => (
                        <li key={c.address}>
                          <span className="break-all">{c.address}</span> — {c.creators.join(", ")}
                        </li>
                      ))}
                    </ul>
                  </Callout>
                )}
              </>
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
          <CardHeader
            title="Campaigns"
            description="What creators are recruited for. Pick one in the sidebar to work in it. A CSV import creates the campaigns named in its Campaign column."
          />
          <div className="mt-3 mb-4">
            {campaigns.length === 0 ? (
              <span className="text-sm text-text-muted">No campaigns yet.</span>
            ) : (
              <CampaignManager campaigns={campaigns.map((c) => ({ id: c.id, name: c.name, creators: counts.get(c.id) ?? 0 }))} />
            )}
          </div>
          <CampaignAdder clientId={client.id} />
        </Card>

        <Card id="client-team" className="scroll-mt-4 p-5">
          <CardHeader
            title={`${client.name}'s team`}
            description={`People at ${client.name}. Their emails on a creator's thread show as ${client.name}'s — never as the creator replying, and never as us. Invite any of them to their own login: they see only ${client.name}'s creators, and can approve creators and mark product shipped.`}
          />
          <div className="mt-3">
            <ClientTeam
              clientId={client.id}
              requiresApproval={!!currentSettings?.requiresApproval}
              ourSideDomains={(gmailAccount?.teamAddresses ?? []).filter((e) => e.startsWith("@")).map((e) => e.slice(1).toLowerCase())}
              clientName={client.name}
              people={clientPeople.map((p) => ({
                ...p,
                inviteExpiresAt: p.inviteExpiresAt && p.inviteExpiresAt > new Date() ? p.inviteExpiresAt.toISOString() : null,
                lastLoginAt: p.lastLoginAt?.toISOString() ?? null,
              }))}
            />
          </div>
        </Card>

        <GroupHeading>Admin · applies to every client</GroupHeading>

        <Card id="team" className="scroll-mt-4 p-5">
          <CardHeader
            title="Team"
            description="Who deals can be assigned to. Nobody needs a login to be on the list; once someone signs in with the email here, Mine shows their deals. Switching someone off keeps them as owner of what they have, but they're no longer offered."
          />
          <div className="mt-3">
            <TeamSettings members={teamMembers} meId={myMember?.id ?? null} />
          </div>
        </Card>

        <Card id="gmail" className="scroll-mt-4 p-5">
          <CardHeader
            title="Mailbox"
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

      </div>
    </>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-2 text-sm font-semibold text-text">{children}</h2>;
}
