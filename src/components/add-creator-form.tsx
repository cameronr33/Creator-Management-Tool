"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Sparkles, Link2 } from "lucide-react";
import { STARTING_STAGES, stageHint, stageLabel } from "@/lib/stages";
import { parseSocialUrl, PLATFORM_LABELS, ENRICHABLE_PLATFORMS } from "@/lib/social-links";
import { Button, IconButton, Field, Input, Select, Callout, Card, CardHeader } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import { toast } from "@/components/toast";

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
  const { pending, run } = useSave();

  const [links, setLinks] = useState<string[]>([""]);
  const [name, setName] = useState("");
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const [newCampaign, setNewCampaign] = useState("");
  const [stage, setStage] = useState("shortlisted");
  const [email, setEmail] = useState("");
  const [pillar, setPillar] = useState("");
  const [followers, setFollowers] = useState("");
  const [fetching, setFetching] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const setLink = (i: number, value: string) =>
    setLinks((prev) => prev.map((l, idx) => (idx === i ? value : l)));
  const addLinkRow = () => setLinks((prev) => [...prev, ""]);
  const removeLinkRow = (i: number) =>
    setLinks((prev) => (prev.length === 1 ? [""] : prev.filter((_, idx) => idx !== i)));

  // Live preview of what each pasted link is understood to be.
  const parsed = links.map((l) => (l.trim() ? parseSocialUrl(l) : null));
  const primary = parsed.find((p) => p !== null) ?? null;
  const canFetch = !!primary && ENRICHABLE_PLATFORMS.includes(primary.platform);

  const fetchDetails = async () => {
    if (!primary) return;
    setFetching(true);
    const r = await api<{ name?: string; followers?: number; businessEmail?: string }>("/api/enrich", { url: primary.url });
    setFetching(false);
    if (r.ok) {
      if (r.data.name && !name) setName(r.data.name);
      if (r.data.followers != null) setFollowers(String(r.data.followers));
      if (r.data.businessEmail && !email) setEmail(r.data.businessEmail);
      toast("Filled in from the Instagram profile", { tone: "good" });
    } else {
      toast(r.data.error ?? "Couldn't fetch the profile — fill the fields in by hand", { tone: "bad" });
    }
  };

  const submit = async () => {
    const issues: string[] = [];
    if (!name.trim() && !links.some((l) => l.trim())) issues.push("Add a name or at least one profile link.");
    if (!campaignId && !newCampaign.trim()) issues.push("Pick a campaign, or type a new campaign name.");
    setProblems(issues);
    if (issues.length) return;

    const r = await run(
      () =>
        api<{ partnershipId: string; reusedPartnership?: boolean }>("/api/creators", {
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
      { refresh: false },
    );
    if (!r.ok) return;
    if (r.data.reusedPartnership) {
      toast("Already tracked on this campaign — opened the existing record", {
        detail: "The stage and details you entered were not applied to it.",
      });
    } else {
      toast(`${name.trim() || "Creator"} added`, { tone: "good" });
    }
    router.push(`/creators/${r.data.partnershipId}`);
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Card className="p-5">
        <CardHeader
          title="Profile links"
          description="Paste any profile — Instagram, TikTok, YouTube, Facebook, X or a website. The first one becomes their main link."
        />
        <div className="mt-3 space-y-2">
          {links.map((link, i) => (
            <div key={i}>
              <div className="flex items-center gap-2">
                <Link2 size={15} className="shrink-0 text-text-faint" />
                <Input
                  value={link}
                  onChange={(e) => setLink(i, e.target.value)}
                  placeholder="https://www.instagram.com/handle"
                  aria-label={`Profile link ${i + 1}`}
                  autoFocus={i === 0}
                />
                {(links.length > 1 || link) && (
                  <IconButton label="Remove link" icon={<X size={15} />} onClick={() => removeLinkRow(i)} />
                )}
              </div>
              {parsed[i] && (
                <div className="mt-1 ml-7 text-xs text-text-muted">
                  {PLATFORM_LABELS[parsed[i]!.platform]}
                  {parsed[i]!.handle ? ` · @${parsed[i]!.handle}` : ""}
                  {i === 0 ? " · main link" : ""}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="link" icon={<Plus size={14} />} onClick={addLinkRow}>
            Add another link
          </Button>
          {primary && (
            <Button
              size="sm"
              icon={<Sparkles size={14} />}
              pending={fetching}
              disabled={!canFetch}
              onClick={fetchDetails}
              title={canFetch ? "Pulls name, followers and public email from the profile" : "Auto-fill only works for Instagram profiles"}
            >
              Auto-fill from Instagram
            </Button>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader title="Creator" />
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name or brand" />
          </Field>
          <Field label="Contact email">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="hello@example.com" type="email" />
          </Field>
          <Field label="Content type" hint="What they post, e.g. Overlanding, DIY, Shop builds.">
            <Input value={pillar} onChange={(e) => setPillar(e.target.value)} />
          </Field>
          <Field label="Followers">
            <Input
              value={followers}
              onChange={(e) => setFollowers(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              className="tabular"
            />
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader title="Where do they go?" description={`Adding to ${clientName}. If this handle is already tracked, they're attached to the existing record instead of duplicated.`} />
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Campaign">
            {campaigns.length > 0 ? (
              <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="">+ New campaign…</option>
              </Select>
            ) : (
              <Input value={newCampaign} onChange={(e) => setNewCampaign(e.target.value)} placeholder="Campaign name" />
            )}
          </Field>
          {campaigns.length > 0 && !campaignId && (
            <Field label="New campaign name">
              <Input value={newCampaign} onChange={(e) => setNewCampaign(e.target.value)} autoFocus />
            </Field>
          )}
          <Field label="Starting stage" hint="Most new creators start at To contact. Move them further along after adding.">
            <Select value={stage} onChange={(e) => setStage(e.target.value)}>
              {STARTING_STAGES.map((s) => (
                <option key={s} value={s} title={stageHint(s)}>
                  {stageLabel(s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {problems.length > 0 && (
        <Callout tone="bad" title="Before adding:">
          <ul className="list-disc pl-4">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={submit} pending={pending} icon={<Plus size={15} />}>
          Add creator
        </Button>
        <Button variant="ghost" href="/creators">
          Cancel
        </Button>
      </div>
    </div>
  );
}
