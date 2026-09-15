import { resolveClient, getDefaultTemplates, getCreatorRows } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { getDashboardStalls } from "@/lib/dashboard";
import { getActiveGmailAccount } from "@/lib/gmail-sync";
import { PageHeader, EmptyState, Callout, Button } from "@/components/ui";
import {
  OutreachWorklist,
  AwaitingReplyList,
  type WorklistEntry,
  type WorklistTemplates,
  type AwaitingReplyEntry,
} from "@/components/outreach-worklist";

export default async function OutreachPage() {
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) {
    return (
      <>
        <PageHeader title="Outreach" />
        <div className="p-6">
          <EmptyState title="No client selected" hint="Pick a client in the sidebar first." />
        </div>
      </>
    );
  }

  const [stalls, templates, rows, gmailAccount] = await Promise.all([
    getDashboardStalls(client.id),
    getDefaultTemplates(client.id),
    getCreatorRows(client.id),
    getActiveGmailAccount(),
  ]);

  const rowByPartnership = new Map(rows.map((r) => [r.partnershipId, r]));
  const dueIds = new Set(stalls.followUpsDue.map((s) => s.partnershipId));

  const entries: WorklistEntry[] = stalls.followUpsDue.map((s) => {
    const row = rowByPartnership.get(s.partnershipId);
    return {
      ...s,
      kind: s.kind ?? "follow_up",
      businessEmail: row?.businessEmail ?? null,
      contentPillar: row?.contentPillar ?? null,
      outreachReason: row?.outreachReason ?? null,
      migrated: s.migrated,
    };
  });

  // Messaged, not yet due for a follow-up, no reply logged: where replies actually land.
  const awaitingReply: AwaitingReplyEntry[] = rows
    .filter((r) => r.stage === "contacted" && !r.repliedAt && r.lastOutboundAt && !dueIds.has(r.partnershipId))
    .sort((a, b) => new Date(b.lastOutboundAt!).getTime() - new Date(a.lastOutboundAt!).getTime())
    .map((r) => ({
      partnershipId: r.partnershipId,
      name: r.name,
      username: r.username,
      lastOutboundAt: r.lastOutboundAt,
    }));

  const worklistTemplates: WorklistTemplates = {
    ig_dm: templates.ig_dm ? { subject: null, body: templates.ig_dm.body } : null,
    email: templates.email
      ? { subject: templates.email.subject, body: templates.email.body }
      : null,
    ccEmail: gmailAccount?.email ?? null,
  };

  return (
    <>
      <PageHeader
        title="Outreach"
        client={client.name}
        subtitle={`${entries.length} to send · ${awaitingReply.length} waiting on a reply`}
        help="Today's messages, pre-written from the client's template. Copy & open puts the message in Instagram or your email app; press I sent it afterwards and the stage moves by itself."
        helpAnchor="daily-loop"
      />
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        {!templates.ig_dm && (
          <Callout
            tone="warn"
            actions={
              <Button size="sm" href="/settings#templates">
                Add a template
              </Button>
            }
          >
            No default DM template for {client.name} yet. Messages here will be blank until one exists.
          </Callout>
        )}
        <OutreachWorklist entries={entries} templates={worklistTemplates} />
        <AwaitingReplyList entries={awaitingReply} />
      </div>
    </>
  );
}
