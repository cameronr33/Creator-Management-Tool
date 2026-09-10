import { resolveClient, getDefaultTemplates, getCreatorRows } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { getDashboardStalls } from "@/lib/dashboard";
import { getActiveGmailAccount } from "@/lib/gmail-sync";
import { PageHeader, EmptyState } from "@/components/ui";
import {
  OutreachWorklist,
  type WorklistEntry,
  type WorklistTemplates,
} from "@/components/outreach-worklist";

export default async function OutreachPage() {
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) {
    return (
      <>
        <PageHeader title="Outreach" />
        <div className="p-6">
          <EmptyState title="No client selected" />
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

  const entries: WorklistEntry[] = stalls.followUpsDue.map((s) => {
    const row = rowByPartnership.get(s.partnershipId);
    return {
      ...s,
      kind: s.kind ?? "follow_up",
      businessEmail: row?.businessEmail ?? null,
      contentPillar: row?.contentPillar ?? null,
      outreachReason: row?.outreachReason ?? null,
    };
  });

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
        subtitle={`${entries.length} due · ${client.name}`}
      />
      <div className="mx-auto max-w-3xl p-6">
        {!templates.ig_dm && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No default DM template for {client.name}. Add one in Settings to get pre-filled messages here.
          </div>
        )}
        <OutreachWorklist entries={entries} templates={worklistTemplates} />
      </div>
    </>
  );
}
