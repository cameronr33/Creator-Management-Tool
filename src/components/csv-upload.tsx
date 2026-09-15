"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Button, Field, Input, Callout } from "@/components/ui";
import { useSave } from "@/components/use-save";

export function CsvUpload({ client }: { client: string }) {
  const { pending, run } = useSave();
  const [file, setFile] = useState<File | null>(null);
  const [campaign, setCampaign] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const submit = async () => {
    if (!file) return;
    setResult(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("client", client);
    if (campaign) fd.set("campaign", campaign);

    const r = await run(
      async () => {
        const res = await fetch("/api/import/csv", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
      },
      { success: "Import finished" },
    );
    if (r.ok) {
      const d = r.data as { created?: number; updated?: number; campaigns?: number };
      setResult(`${d.created ?? 0} new creator(s), ${d.updated ?? 0} refreshed, across ${d.campaigns ?? 0} campaign(s).`);
      setFile(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Research CSV">
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-text transition hover:bg-surface-2">
            <Upload size={15} className="text-text-muted" />
            {file ? file.name : "Choose a file…"}
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </Field>
        <Field label="Campaign for rows without one" hint="Optional — only used when a row has no campaign column." className="w-64">
          <Input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="e.g. Evergreen creators" />
        </Field>
        <Button variant="primary" onClick={submit} disabled={!file} pending={pending} className="mb-5">
          Import
        </Button>
      </div>
      {result && <Callout tone="good">{result}</Callout>}
      <p className="text-xs text-text-muted">
        Rows are matched to existing creators by handle. Re-importing refreshes research numbers and never touches
        stage, messages, shipping or videos.
      </p>
    </div>
  );
}
