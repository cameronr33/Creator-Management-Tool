import { resolveClient, getResearchRuns } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { PageHeader, Card, SectionTitle, EmptyState, Badge } from "@/components/ui";
import { CsvUpload } from "@/components/csv-upload";
import { shortDate } from "@/lib/format";

export default async function ImportPage() {
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) {
    return (
      <>
        <PageHeader title="Import" />
        <div className="p-6">
          <EmptyState title="No client selected" />
        </div>
      </>
    );
  }

  const runs = await getResearchRuns(client.id);

  return (
    <>
      <PageHeader title="Import research" subtitle={client.name} />
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <Card className="p-5">
          <SectionTitle>Upload a research CSV</SectionTitle>
          <div className="mt-3">
            <CsvUpload client={client.slug} />
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle>Automated push from Claude Code</SectionTitle>
          <div className="mt-3 space-y-3 text-sm text-text-muted">
            <p>
              The <code className="rounded bg-surface-2 px-1">creator-research</code> skill can POST
              results straight in. Create an API key in Settings, then the skill&apos;s Step 12 sends to:
            </p>
            <pre className="overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 text-xs text-text">
{`POST ${process.env.APP_URL ?? "http://localhost:3002"}/api/ingest/research
Authorization: Bearer <your cm_ api key>

{ "client": "${client.slug}", "campaign": "…", "creators": [ … ] }`}
            </pre>
            <p className="text-xs text-text-faint">
              Re-running research refreshes metrics and reels without disturbing any pipeline state
              (stage, outreach, shipping, deliverables are never overwritten).
            </p>
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle>Recent runs</SectionTitle>
          {runs.length === 0 ? (
            <p className="mt-3 text-sm text-text-faint">No research runs yet.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-text-faint">
                  <th className="py-1.5 font-semibold">When</th>
                  <th className="py-1.5 font-semibold">Source</th>
                  <th className="py-1.5 font-semibold">Handles</th>
                  <th className="py-1.5 font-semibold">Result</th>
                  <th className="py-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 text-text-muted">{shortDate(r.startedAt)}</td>
                    <td className="py-2 text-text-muted">{r.source === "skill_api" ? "Skill API" : "CSV upload"}</td>
                    <td className="py-2 tabular text-text-muted">{r.handleCount}</td>
                    <td className="py-2 tabular text-text-muted">
                      +{r.createdCount} new, {r.updatedCount} updated
                    </td>
                    <td className="py-2">
                      <Badge tone={r.status === "completed" ? "good" : r.status === "failed" ? "warn" : "muted"}>
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
