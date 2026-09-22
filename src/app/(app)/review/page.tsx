import type { Metadata } from "next";
import { Badge, Button, Callout, Card, CardHeader, PageHeader } from "@/components/ui";
import { EmailSuggestions } from "@/components/email-suggestions";
import { GmailSyncStatus, type GmailAccountView } from "@/components/settings-forms";
import { getActiveGmailAccount } from "@/lib/gmail-sync";
import { countOpenSuggestions, getAllCreatorRefs, listOpenSuggestions } from "@/lib/email-suggestions";
import { summarizeGmailHealth } from "@/lib/gmail-health";
import { resolveClient } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { getWorkspaceItems } from "@/lib/workspace-data";

export const metadata: Metadata = { title: "Needs review" };
const PAGE_SIZE = 50;

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const requestedPage = typeof sp.page === "string" ? Number(sp.page) : 1;
  const [account, openCount, creators, client] = await Promise.all([
    getActiveGmailAccount(),
    countOpenSuggestions(),
    getAllCreatorRefs(),
    getSelectedClientSlug().then(resolveClient),
  ]);
  const pages = Math.max(1, Math.ceil(openCount / PAGE_SIZE));
  const page = Number.isSafeInteger(requestedPage) ? Math.min(pages, Math.max(1, requestedPage)) : 1;
  const offset = (page - 1) * PAGE_SIZE;
  const [suggestions, items] = await Promise.all([
    listOpenSuggestions(PAGE_SIZE, offset),
    client ? getWorkspaceItems(client.id) : Promise.resolve([]),
  ]);
  const partnershipChecks = items.filter(item => item.lane === "review");
  const health = summarizeGmailHealth(account, openCount);
  const accountView: GmailAccountView | null = account ? {
    email: account.email,
    connectedAt: account.connectedAt.toLocaleDateString(),
    lastSyncAt: account.lastSyncAt?.toLocaleString() ?? null,
    lastSyncStatus: account.lastSyncStatus,
    lastSyncSummary: account.lastSyncSummary as GmailAccountView["lastSyncSummary"],
    health,
  } : null;

  return (
    <>
      <PageHeader
        title="Needs review"
        subtitle={`${partnershipChecks.length} partnership check${partnershipChecks.length === 1 ? "" : "s"}${client ? ` for ${client.name}` : ""} · ${openCount} unmatched sender${openCount === 1 ? "" : "s"} across all clients`}
        help="Check uncertain partnership records and confirm which email addresses belong to creators."
        helpAnchor="email"
        actions={<Button href="/settings#gmail">Gmail settings</Button>}
      />
      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
        <Card className="p-5">
          <CardHeader
            title={<>Partnership checks{client ? ` · ${client.name}` : ""} <Badge tone={partnershipChecks.length > 0 ? "warn" : "neutral"}>{partnershipChecks.length}</Badge></>}
            description="These checks use the selected client's recorded activity. Review the conversation and supporting details before changing a status."
            actions={client ? <Button href="/?work=review" size="sm">View in Today</Button> : undefined}
          />
          {partnershipChecks.length > 0 ? (
            <ul className="mt-3 divide-y divide-border">
              {partnershipChecks.slice(0, 4).map(item => (
                <li key={item.partnershipId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text">{item.name} <span className="font-normal text-text-muted">· {item.campaignName}</span></p>
                    <p className="mt-1 text-xs text-text-muted">{item.next}</p>
                  </div>
                  <Button href={`/creators/${item.partnershipId}?tab=${item.tab}&returnTo=${encodeURIComponent("/?work=review")}`} size="sm">{item.action}</Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text-muted">{client ? "No partnership checks are currently flagged for this client." : "Choose a client to see partnership checks."}</p>
          )}
          {partnershipChecks.length > 4 && <p className="mt-2 text-xs text-text-muted">Showing 4 of {partnershipChecks.length}; open Today to see all checks.</p>}
        </Card>

        <Callout tone="info" title="Shared mailbox · all clients">
          The unmatched-sender queue below is not filtered by the client selected in the sidebar. It can include creators, client contacts,
          and vendors from any client. Check the sender and subject before linking an address.
        </Callout>

        <Card className="p-5">
          <CardHeader title="Email tracking" description="Replies are visible only when the connected mailbox receives them. A successful check does not guarantee a complete conversation." />
          <div className="mt-3">
            {accountView ? <GmailSyncStatus account={accountView} /> : (
              <Callout tone={health.tone} title={health.label} actions={<Button href="/settings#gmail" size="sm">Connect Gmail</Button>}>
                {health.detail}{openCount > 0 ? " Existing suggestions remain available below, but new mail is not being checked." : ""}
              </Callout>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <CardHeader
            title={<>Unmatched senders <Badge tone={openCount > 0 ? "warn" : "neutral"}>{openCount}</Badge></>}
            description="Link a sender only when you recognize their creator record. Use Not a creator for addresses that should stay out of creator tracking. Suggestions still need your confirmation."
          />
          <div className="mt-4">
            <EmailSuggestions
              suggestions={suggestions.map((s) => ({
                id: s.id,
                email: s.email,
                displayName: s.displayName,
                messageCount: s.messageCount,
                lastSeenAt: s.lastSeenAt?.toLocaleDateString() ?? null,
                sampleSubject: s.sampleSubject,
                suggestedCreatorId: s.suggestedCreatorId,
                suggestedCreatorName: s.suggestedCreatorName,
              }))}
              creators={creators.map((c) => ({ id: c.id, name: c.name, clientName: c.clientName }))}
            />
          </div>
          {openCount > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-text-muted">
              <span>Showing {offset + 1}–{offset + suggestions.length} of {openCount}</span>
              <nav aria-label="Review queue pages" className="flex items-center gap-2">
                <Button href={`/review?page=${page - 1}`} disabled={page <= 1} size="sm">Previous</Button>
                <span>Page {page} of {pages}</span>
                <Button href={`/review?page=${page + 1}`} disabled={page >= pages} size="sm">Next</Button>
              </nav>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
