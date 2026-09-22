"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useRef } from "react";
import { ArrowRight, Search, Users, Mail, FileText, Package, Clapperboard, Sparkles } from "lucide-react";
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, Select, StagePill, cn } from "@/components/ui";
import { STAGES } from "@/lib/stages";
import type { WorkspaceItem, WorkLane } from "@/lib/workspace";
import { clearCreatorFilters } from "@/lib/workspace";
import { compactNumber } from "@/lib/format";

const LANES: { value: WorkLane | "all"; label: string }[] = [
  { value: "action", label: "Needs action" }, { value: "waiting", label: "Waiting" },
  { value: "review", label: "Needs review" }, { value: "all", label: "All partnerships" },
];
const LANE_LABELS: Record<WorkLane, string> = { action: "Our team", waiting: "Waiting", review: "Review needed", closed: "Closed" };
const PRIORITY: Record<WorkLane, number> = { review: 0, action: 1, waiting: 2, closed: 3 };

export function CreatorWorkspace({ items, mode = "today" }: { items: WorkspaceItem[]; mode?: "today" | "directory" }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const search = params.get("q") ?? "";
  const campaign = params.get("campaign") ?? "";
  const stage = params.get("stage") ?? "";
  const laneParam = params.get("work");
  const lane = LANES.some(l => l.value === laneParam) ? laneParam! : mode === "today" ? "action" : "all";
  const selectedId = params.get("selected");
  const previewRef = useRef<HTMLElement>(null);
  const campaigns = [...new Map(items.map(i => [i.campaignId, i.campaignName])).entries()];
  const filtered = items.filter(i =>
    (!campaign || i.campaignId === campaign) && (!stage || i.stage === stage) &&
    (!search || [i.name, i.username, i.contentPillar ?? "", i.campaignName].some(s => s.toLowerCase().includes(search.toLowerCase()))),
  );
  const visible = filtered.filter(i => lane === "all" || i.lane === lane)
    .sort((a, b) => PRIORITY[a.lane] - PRIORITY[b.lane] || Number(!!b.dueLabel) - Number(!!a.dueLabel) || a.name.localeCompare(b.name));
  const selected = visible.find(i => i.partnershipId === selectedId) ?? visible[0];
  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "selected") next.delete("selected");
    window.history.replaceState(null, "", `${pathname}${next.size ? `?${next}` : ""}`);
  }
  function href(item: WorkspaceItem, tab = item.tab) {
    const back = `${pathname}${params.size ? `?${params}` : ""}`;
    return `/creators/${item.partnershipId}?tab=${tab}&returnTo=${encodeURIComponent(back)}`;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" aria-label="Work views">
        {LANES.map(l => <Link key={l.value} scroll={false} href={`${pathname}?${new URLSearchParams({ ...Object.fromEntries(params), work: l.value, selected: "" })}`}
          aria-current={lane === l.value ? "page" : undefined}
          className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition", lane === l.value ? "border-accent-ring bg-accent-soft font-semibold text-accent" : "border-border bg-surface text-text-muted hover:border-border-strong")}>
          {l.label}<span className="text-xs tabular">{l.value === "all" ? filtered.length : filtered.filter(i => i.lane === l.value).length}</span>
        </Link>)}
      </div>
      <Card className="p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_180px_180px_auto] lg:items-end">
          <Field label="Find a creator">
            <div className="relative"><Search size={15} className="pointer-events-none absolute left-3 top-3 text-text-faint" />
              <Input value={search} onChange={e => setParam("q", e.target.value)} placeholder="Name, handle or content type" className="pl-9" />
            </div>
          </Field>
          <Field label="Campaign"><Select value={campaign} onChange={e => setParam("campaign", e.target.value)}>
            <option value="">All campaigns</option>{campaigns.map(([id, name]) => <option value={id} key={id}>{name}</option>)}
          </Select></Field>
          <Field label="Stage"><Select value={stage} onChange={e => setParam("stage", e.target.value)}>
            <option value="">All stages</option>{STAGES.map(s => <option value={s.value} key={s.value}>{s.label}</option>)}
          </Select></Field>
          {(search || campaign || stage) && <Button variant="ghost" onClick={() => {
            const next = clearCreatorFilters(params.toString());
            window.history.replaceState(null, "", `${pathname}?${next}`);
          }}>Clear filters</Button>}
        </div>
      </Card>
      {!visible.length ? <EmptyState icon={<Users size={24} />} title={lane === "action" ? "No actions in this view" : "No matching partnerships"}
        hint="Check Waiting and Needs review, or clear your filters. Research and completed partnerships are available in All partnerships."
        action={<Button onClick={() => setParam("work", "all")}>Show all partnerships</Button>} /> :
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="overflow-hidden" id="worklist">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">{LANES.find(l => l.value === lane)?.label}</h2>
              <span className="text-xs text-text-muted">{visible.length} partnership{visible.length === 1 ? "" : "s"}</span>
            </div>
            <ul className="divide-y divide-border">
              {visible.map(item => <li key={item.partnershipId} className={cn("p-4 transition", selected?.partnershipId === item.partnershipId && "bg-accent-soft/50")}>
                <div className="flex items-start gap-3">
                  <Avatar name={item.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={href(item, "overview")} className="font-semibold text-sm hover:text-accent">{item.name}</Link>
                      <StagePill stage={item.stage} />
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">@{item.username} · {item.campaignName}</p>
                    <p className="mt-2 text-sm font-medium text-text">{item.action}</p>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">{item.next}</p>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={item.lane === "review" ? "warn" : "neutral"}>{item.lane === "waiting" ? `Waiting on ${item.waitingOn.toLowerCase()}` : LANE_LABELS[item.lane]}</Badge>
                        {item.dueLabel && <Badge tone="warn">{item.dueLabel}</Badge>}
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => {
                          setParam("selected", item.partnershipId);
                          if (window.matchMedia("(max-width: 1279px)").matches) requestAnimationFrame(() => {
                            previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                            previewRef.current?.focus({ preventScroll: true });
                          });
                        }} aria-label={`Preview ${item.name}`}>Preview</Button>
                        <Button size="sm" href={href(item)} icon={<ArrowRight size={13} />}>Open task</Button>
                      </div>
                    </div>
                  </div>
                </div>
              </li>)}
            </ul>
          </Card>
          {selected && <aside ref={previewRef} tabIndex={-1} className="space-y-3 xl:sticky xl:top-4" aria-label="Creator preview" aria-live="polite">
            <div className="xl:hidden"><Button size="sm" href="#worklist">Back to worklist</Button></div>
            <Card className="p-5">
              <div className="flex items-center gap-3"><Avatar name={selected.name} size="lg" /><div className="min-w-0"><h2 className="text-base font-semibold">{selected.name}</h2><p className="text-xs text-text-muted">@{selected.username}</p></div></div>
              <p className="mt-3 text-xs text-text-muted">{selected.contentPillar || "Content type not recorded"} · {compactNumber(selected.followers)} followers</p>
              <div className="mt-3"><StagePill stage={selected.stage} /></div>
              <div className="mt-4 rounded-lg bg-surface-2 p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-text-faint">Next action</p><p className="mt-1 text-sm font-medium">{selected.action}</p><p className="mt-1 text-xs leading-relaxed text-text-muted">{selected.next}</p></div>
              <dl className="mt-4 space-y-3 text-xs">
                <Track icon={<FileText size={14} />} label="Agreement" value={selected.agreement} href={href(selected, "agreement")} />
                <Track icon={<Package size={14} />} label="Shipping" value={selected.shipping} href={href(selected, "shipping")} />
                <Track icon={<Clapperboard size={14} />} label="Content" value={selected.content} href={href(selected, "content")} />
                <Track icon={<Mail size={14} />} label="Last contact" value={selected.lastContact} href={href(selected, "conversation")} />
              </dl>
              <div className="mt-5 grid gap-2"><Button variant="primary" href={href(selected, "overview")}>Open creator workspace</Button><Button href={href(selected, "profile")} icon={<Sparkles size={14} />}>Profile & research</Button></div>
            </Card>
            <p className="px-1 text-xs leading-relaxed text-text-faint">Suggested work comes from recorded facts. Open the creator to review the conversation and update the record.</p>
          </aside>}
        </div>}
    </div>
  );
}

function Track({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string; href: string }) {
  return <div><dt className="flex items-center gap-1.5 text-text-faint">{icon}{label}</dt><dd className="mt-1"><Link href={href} className="leading-relaxed text-text hover:text-accent">{value}</Link></dd></div>;
}
