"use client";

import Link from "next/link";
import { useState } from "react";
import { Download, FileUp, Upload } from "lucide-react";
import { Badge, Button, Callout, Field, Input } from "@/components/ui";
import { useSave } from "@/components/use-save";
import type { ImportPlan, ImportResult, RowOutcome } from "@/lib/csv-import";

const OUTCOME: Record<RowOutcome, { label: string; tone: "good" | "info" | "muted" }> = {
  new: { label: "New creator", tone: "good" },
  added_to_campaign: { label: "Joins this campaign", tone: "info" },
  already_there: { label: "Already there", tone: "muted" },
};

/**
 * Upload → see exactly what will happen → Import. Nothing is written until
 * the Import button; importing the same file twice changes nothing.
 */
export function CsvImport({ defaultCampaign }: { defaultCampaign: string }) {
  const { pending, run } = useSave();
  const [file, setFile] = useState<File | null>(null);
  const [campaign, setCampaign] = useState(defaultCampaign);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [done, setDone] = useState<(ImportResult & { problems: ImportPlan["problems"] }) | null>(null);

  const send = (mode: "preview" | "import") => {
    const fd = new FormData();
    fd.set("file", file!);
    fd.set("mode", mode);
    fd.set("defaultCampaign", campaign);
    return run(
      async () => {
        const res = await fetch("/api/import/csv", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
      },
      { refresh: mode === "import" },
    );
  };

  const preview = async () => {
    setDone(null);
    const r = await send("preview");
    setPlan(r.ok ? (r.data as unknown as ImportPlan) : null);
  };

  const doImport = async () => {
    const r = await send("import");
    if (r.ok) {
      setDone(r.data as unknown as ImportResult & { problems: ImportPlan["problems"] });
      setPlan(null);
    }
  };

  if (done) {
    return (
      <div className="space-y-3">
        <Callout tone={done.failed.length ? "warn" : "good"} title="Import finished">
          {done.created} new creator{done.created === 1 ? "" : "s"} · {done.addedToCampaign} joined a campaign · {done.alreadyThere} already there
          {done.campaignsCreated.length > 0 && <> · created {done.campaignsCreated.join(", ")}</>}. Photos and followers are being fetched and will
          appear in a minute or two.
        </Callout>
        {done.failed.length > 0 && <ProblemList title="These rows failed" problems={done.failed} />}
        {done.problems.length > 0 && <ProblemList title="These rows were skipped" problems={done.problems} />}
        <div className="flex gap-2">
          <Button variant="primary" href="/creators">
            Go to Creators
          </Button>
          <Button
            onClick={() => {
              setDone(null);
              setFile(null);
            }}
          >
            Import another file
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_16rem] sm:items-end">
        <Field label="CSV file" hint="A Name column, and a Campaign column. Instagram and Email are optional.">
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPlan(null);
            }}
          />
        </Field>
        <Field label="Campaign for rows that don't name one">
          <Input value={campaign} onChange={(e) => { setCampaign(e.target.value); setPlan(null); }} placeholder="General" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={plan ? "secondary" : "primary"} icon={<FileUp size={15} />} disabled={!file} pending={pending && !plan} onClick={preview}>
          Check the file
        </Button>
        <Button variant="ghost" icon={<Download size={15} />} href="/creators-template.csv">
          Download a template
        </Button>
      </div>

      {plan && (
        <div className="space-y-3">
          <Callout tone="info" title="Here's what will happen — nothing is saved until you press Import">
            {plan.counts.new} new · {plan.counts.added_to_campaign} join a campaign · {plan.counts.already_there} already there
            {plan.newCampaigns.length > 0 && (
              <>
                {" "}· new campaign{plan.newCampaigns.length === 1 ? "" : "s"}: <strong>{plan.newCampaigns.join(", ")}</strong>
              </>
            )}
            . Columns read: {Object.values(plan.columns).join(", ")}.
          </Callout>
          {plan.problems.length > 0 && <ProblemList title="These rows will be skipped" problems={plan.problems} />}
          <div className="max-h-96 overflow-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border text-left text-xs font-semibold text-text-muted">
                  <th className="px-3 py-2">Line</th>
                  <th className="px-3 py-2">Creator</th>
                  <th className="px-3 py-2">Campaign</th>
                  <th className="px-3 py-2">What happens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {plan.rows.map((r) => (
                  <tr key={r.line}>
                    <td className="px-3 py-1.5 tabular text-text-faint">{r.line}</td>
                    <td className="px-3 py-1.5">
                      <span className="font-medium text-text">{r.existingName ?? r.name}</span>
                      {r.handle ? <span className="text-text-muted"> @{r.handle}</span> : <span className="text-text-faint"> · name only</span>}
                      {r.email && <span className="text-text-muted"> · {r.email}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-text-muted">
                      {r.campaign}
                      {plan.newCampaigns.includes(r.campaign) && <Badge tone="warn" className="ml-1">new</Badge>}
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge tone={OUTCOME[r.outcome].tone}>{OUTCOME[r.outcome].label}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="primary" icon={<Upload size={15} />} pending={pending} disabled={plan.counts.new + plan.counts.added_to_campaign === 0} onClick={doImport}>
            Import {plan.counts.new + plan.counts.added_to_campaign} creator{plan.counts.new + plan.counts.added_to_campaign === 1 ? "" : "s"}
          </Button>
        </div>
      )}
      <p className="text-xs text-text-faint">
        New creators start in To contact. People already here only get empty fields filled — nothing they have is overwritten, except that hand-checked view counts replace estimated ones. Want one at a time?{" "}
        <Link href="/creators/new" className="underline hover:text-accent">
          Add a creator
        </Link>
        .
      </p>
    </div>
  );
}

function ProblemList({ title, problems }: { title: string; problems: { line: number; message: string }[] }) {
  return (
    <Callout tone="warn" title={title}>
      <ul className="mt-1 space-y-0.5">
        {problems.slice(0, 20).map((p) => (
          <li key={`${p.line}-${p.message}`}>
            Line {p.line}: {p.message}
          </li>
        ))}
        {problems.length > 20 && <li>…and {problems.length - 20} more.</li>}
      </ul>
    </Callout>
  );
}
