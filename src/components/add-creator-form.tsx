"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, X, Sparkles, Loader2, Link2 } from "lucide-react";
import { STAGES } from "@/lib/stages";
import { parseSocialUrl, PLATFORM_LABELS } from "@/lib/social-links";

interface Campaign {
  id: string;
  name: string;
}

export function AddCreatorForm({
  clientId,
  clientName,
  campaigns,
}: {
  clientId: string;
  clientName: string;
  campaigns: Campaign[];
}) {
  const router = useRouter();

  const [links, setLinks] = useState<string[]>([""]);
  const [name, setName] = useState("");
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const [newCampaign, setNewCampaign] = useState("");
  const [stage, setStage] = useState("researched");
  const [email, setEmail] = useState("");
  const [pillar, setPillar] = useState("");
  const [followers, setFollowers] = useState("");

  const [fetching, setFetching] = useState(false);
  const [fetchNote, setFetchNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setLink = (i: number, value: string) =>
    setLinks((prev) => prev.map((l, idx) => (idx === i ? value : l)));
  const addLinkRow = () => setLinks((prev) => [...prev, ""]);
  const removeLinkRow = (i: number) =>
    setLinks((prev) => (prev.length === 1 ? [""] : prev.filter((_, idx) => idx !== i)));

  // Live preview of what each pasted link is understood to be.
  const parsed = links.map((l) => (l.trim() ? parseSocialUrl(l) : null));
  const primary = parsed.find((p) => p !== null) ?? null;
  const canFetch =
    !!primary && ["instagram", "tiktok", "youtube"].includes(primary.platform);

  const fetchDetails = async () => {
    if (!primary) return;
    setFetching(true);
    setFetchNote(null);
    const res = await fetch("/api/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: primary.url }),
    });
    const data = await res.json().catch(() => ({}));
    setFetching(false);
    if (data.ok) {
      if (data.name && !name) setName(data.name);
      if (data.followers != null) setFollowers(String(data.followers));
      if (data.businessEmail && !email) setEmail(data.businessEmail);
      setFetchNote("Filled in from the profile.");
    } else {
      setFetchNote(data.error ?? "Could not fetch — fill the fields in manually.");
    }
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/creators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        name,
        links: links.filter((l) => l.trim()),
        campaignId: campaignId || undefined,
        campaignName: campaignId ? undefined : newCampaign.trim() || undefined,
        stage,
        businessEmail: email || null,
        contentPillar: pillar || null,
        followers: followers ? Number(followers) : null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok || !data.ok) {
      setError(data.error ?? "Could not add this creator.");
      return;
    }
    router.push(`/creators/${data.partnershipId}`);
    router.refresh();
  };

  const nothingEntered = !name.trim() && !links.some((l) => l.trim());
  const noCampaign = !campaignId && !newCampaign.trim();

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* Links */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-text">Profile links</h2>
        <p className="mt-0.5 text-xs text-text-muted">
          Paste any profile — Instagram, Facebook, TikTok, YouTube, X or a website. The first one
          becomes their primary link.
        </p>
        <div className="mt-3 space-y-2">
          {links.map((link, i) => (
            <div key={i}>
              <div className="flex items-center gap-2">
                <Link2 size={15} className="shrink-0 text-text-faint" />
                <input
                  value={link}
                  onChange={(e) => setLink(i, e.target.value)}
                  placeholder="https://www.instagram.com/handle"
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                />
                {(links.length > 1 || link) && (
                  <button
                    onClick={() => removeLinkRow(i)}
                    className="rounded-md p-1.5 text-text-faint transition hover:bg-surface-2 hover:text-red-600"
                    aria-label="Remove link"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
              {parsed[i] && (
                <div className="ml-7 mt-1 text-xs text-text-faint">
                  {PLATFORM_LABELS[parsed[i]!.platform]}
                  {parsed[i]!.handle ? ` · @${parsed[i]!.handle}` : ""}
                  {i === 0 ? " · primary" : ""}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <button onClick={addLinkRow} className="flex items-center gap-1 text-sm text-accent hover:underline">
            <Plus size={14} /> Add another link
          </button>
          {canFetch && (
            <button
              onClick={fetchDetails}
              disabled={fetching}
              className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-sm text-text-muted transition hover:bg-surface-2 disabled:opacity-60"
            >
              {fetching ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Fetch details
            </button>
          )}
        </div>
        {fetchNote && <p className="mt-2 text-xs text-text-muted">{fetchNote}</p>}
      </section>

      {/* Identity */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-text">Creator</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name or brand"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </Field>
          <Field label="Contact email">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="hello@example.com"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </Field>
          <Field label="Content pillar">
            <input
              value={pillar}
              onChange={(e) => setPillar(e.target.value)}
              placeholder="Overlanding, DIY / Shops…"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </Field>
          <Field label="Followers">
            <input
              value={followers}
              onChange={(e) => setFollowers(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="0"
              inputMode="numeric"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm tabular outline-none focus:border-accent"
            />
          </Field>
        </div>
      </section>

      {/* Placement */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-text">Where do they go?</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Campaign">
            {campaigns.length > 0 ? (
              <select
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              >
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="">+ New campaign…</option>
              </select>
            ) : (
              <input
                value={newCampaign}
                onChange={(e) => setNewCampaign(e.target.value)}
                placeholder="Campaign name"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
            )}
            {campaigns.length > 0 && !campaignId && (
              <input
                value={newCampaign}
                onChange={(e) => setNewCampaign(e.target.value)}
                placeholder="New campaign name"
                className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
            )}
          </Field>
          <Field label="Starting stage">
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            >
              {STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="mt-2 text-xs text-text-faint">
          Adding to <span className="font-medium text-text-muted">{clientName}</span>. If this
          handle is already tracked, they&apos;ll be attached rather than duplicated.
        </p>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={saving || nothingEntered || noCampaign}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          Add creator
        </button>
        <Link
          href="/creators"
          className="rounded-lg px-3 py-2 text-sm text-text-muted transition hover:bg-surface-2"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      {children}
    </label>
  );
}
