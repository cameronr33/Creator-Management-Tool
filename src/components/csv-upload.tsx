"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2 } from "lucide-react";

export function CsvUpload({ client }: { client: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [campaign, setCampaign] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!file) return;
    setPending(true);
    setResult(null);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("client", client);
    if (campaign) fd.set("campaign", campaign);

    const res = await fetch("/api/import/csv", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setPending(false);
    if (res.ok) {
      setResult(`Imported ${data.created} new, ${data.updated} updated across ${data.campaigns} campaign(s).`);
      setFile(null);
      router.refresh();
    } else {
      setError(data.error ?? "Import failed");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2">
          <Upload size={15} />
          {file ? file.name : "Choose CSV…"}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <input
          value={campaign}
          onChange={(e) => setCampaign(e.target.value)}
          placeholder="Fallback campaign (optional)"
          className="w-56 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          onClick={submit}
          disabled={!file || pending}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {pending && <Loader2 size={14} className="animate-spin" />}
          Import
        </button>
      </div>
      {result && <p className="text-sm text-emerald-700">{result}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-text-faint">
        Accepts a creator-research skill CSV. Rows are matched to existing creators by handle;
        re-importing refreshes research without disturbing pipeline state.
      </p>
    </div>
  );
}
