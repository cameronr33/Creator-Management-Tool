import { resolveClient, getDefaultTemplate, getCreatorRows } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { getDashboardStalls } from "@/lib/dashboard";
import { PageHeader, EmptyState } from "@/components/ui";
import { OutreachWorklist, type WorklistEntry } from "@/components/outreach-worklist";
import { renderTemplate, firstName } from "@/lib/outreach";

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

  const [stalls, template, rows] = await Promise.all([
    getDashboardStalls(client.id),
    getDefaultTemplate(client.id),
    getCreatorRows(client.id),
  ]);

  const pillarByPartnership = new Map(rows.map((r) => [r.partnershipId, r.contentPillar]));

  const entries: WorklistEntry[] = stalls.followUpsDue.map((s) => {
    const kind: "initial" | "follow_up" = s.detail.includes("initial") ? "initial" : "follow_up";
    const message = template
      ? renderTemplate(template.body, {
          name: firstName(s.name),
          content_descriptor: pillarByPartnership.get(s.partnershipId) ?? "content",
          reason: "",
        })
      : null;
    return { ...s, message, kind };
  });

  return (
    <>
      <PageHeader
        title="Outreach"
        subtitle={`${entries.length} due · ${client.name}`}
      />
      <div className="mx-auto max-w-3xl p-6">
        {!template && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No default message template for {client.name}. Add one in Settings to get pre-filled messages here.
          </div>
        )}
        <OutreachWorklist entries={entries} />
      </div>
    </>
  );
}
