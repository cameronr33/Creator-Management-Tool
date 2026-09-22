import type { Metadata } from "next";
import { resolveClient, getResearchRuns } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { PageHeader, Card, CardHeader, EmptyState, Badge } from "@/components/ui";
import { CsvUpload } from "@/components/csv-upload";
import { shortDate } from "@/lib/format";

export const metadata: Metadata = { title: "Import research" };

export default async function ImportPage() {
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) {
    return (
      <>
        <PageHeader title="Import research" />
        <div className="p-6">
          <EmptyState title="No client selected" hint="Pick a client in the sidebar first." />
        </div>
      </>
    );
  }

  const runs = await getResearchRuns(client.id);

  return (
    <>
      <PageHeader
        title="Import research"
        client={client.name}
        help="A research run is a batch of creators found and measured by the creator-research process. Each run adds new creators as Researched and refreshes the numbers on ones already here — it never touches stage, messages, shipping or videos."
        helpAnchor="numbers"
      />
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <Card className="p-5">
          <CardHeader
            title="Upload a research CSV"
            description="The CSV the creator-research process writes. If you were handed one, this is where it goes."
          />
          <div className="mt-4">
            <CsvUpload client={client.slug} />
          </div>
        </Card>

        <Card className="p-5">
          <CardHeader
            title="Recent runs"
            description="Every import and every automatic push, newest first."
          />
          {runs.length === 0 ? (
            <p className="mt-3 text-sm text-text-muted">No research runs yet.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-text-muted">
                  <th className="py-1.5 font-semibold">When</th>
                  <th className="py-1.5 font-semibold">How</th>
                  <th className="py-1.5 font-semibold">Handles</th>
                  <th className="py-1.5 font-semibold">Result</th>
                  <th className="py-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 text-text-muted">{shortDate(r.startedAt)}</td>
                    <td className="py-2 text-text-muted">{r.source === "skill_api" ? "Automatic push" : "CSV upload"}</td>
                    <td className="py-2 tabular text-text-muted">{r.handleCount}</td>
                    <td className="py-2 tabular text-text-muted">
                      +{r.createdCount} new, {r.updatedCount} refreshed
                    </td>
                    <td className="py-2">
                      <Badge tone={r.status === "completed" ? "good" : r.status === "failed" ? "bad" : "muted"}>
                        {r.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
