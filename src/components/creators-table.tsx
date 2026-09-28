"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, ExternalLink, ImageDown, Mail, NotebookPen, Trash2, X } from "lucide-react";
import { Avatar, Badge, Button, Checkbox, Field, Select, StagePill } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { api, useSave } from "@/components/use-save";
import { toast } from "@/components/toast";
import { stagesByGroup } from "@/lib/stages";
import { compactNumber, relativeDays } from "@/lib/format";
import type { CmStage } from "@/lib/db/schema";

export interface CreatorsTableRow {
  partnershipId: string;
  name: string;
  username: string;
  profileUrl: string;
  businessEmail: string | null;
  followers: number | null;
  stage: CmStage;
  campaignName: string;
  emailWhoseTurn: string | null;
  lastOutboundAt: string | null;
  repliedAt: string | null;
  photoUrl: string | null;
  clientApproval: "pending" | "approved" | "passed" | null;
  /** Where things stand: our own note when there is one, else the latest message's line. */
  standing: { text: string; ours: boolean; at: string | null };
  whoseTurn: "us" | "them" | "none" | null;
}

/**
 * The list you manage. Tick rows (or all of them) to move them to a stage,
 * move them to another campaign, or delete them. Delete removes the creator
 * from the campaign each row is in; a creator left with no campaign is
 * removed from the database entirely — the confirm says which.
 */
export function CreatorsTable({
  rows,
  campaigns,
  scopeName,
}: {
  rows: CreatorsTableRow[];
  campaigns: { id: string; name: string }[];
  /** The sidebar campaign, or null for all campaigns. */
  scopeName: string | null;
}) {
  const { pending, run } = useSave();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const visible = useMemo(() => new Set(rows.map((r) => r.partnershipId)), [rows]);
  // Rows can disappear after a refresh (deleted, moved out of scope): drop them from the selection.
  const chosen = [...selected].filter((id) => visible.has(id));
  const all = rows.length > 0 && chosen.length === rows.length;

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const bulk = async (body: Record<string, unknown>, describe: (d: Record<string, number>) => string) => {
    const r = await run(() => api<Record<string, number>>("/api/partnerships/bulk", { ...body, ids: chosen }));
    if (r.ok) {
      toast(describe(r.data), { tone: "good" });
      setSelected(new Set());
    }
  };

  const where = scopeName ? `from ${scopeName}` : "from the campaign each is in";

  return (
    <div className="space-y-3">
      {chosen.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-end gap-3 rounded-xl border border-accent-ring bg-surface p-3 shadow-pop">
          <div className="flex items-center gap-2 self-center text-sm font-medium text-text">
            {chosen.length} selected
            <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
          <Field label="Move to stage">
            <Select
              compact
              value=""
              disabled={pending}
              onChange={(e) =>
                e.target.value &&
                bulk({ action: "set_stage", stage: e.target.value }, (d) =>
                  `${d.moved ?? 0} moved${d.needVideo ? ` · ${d.needVideo} need their video link first (open them to add it)` : ""}${d.unchanged ? ` · ${d.unchanged} already there` : ""}`,
                )
              }
              className="w-44"
            >
              <option value="">Choose…</option>
              {stagesByGroup().map((g) => (
                <optgroup key={g.group} label={g.label}>
                  {g.stages.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          {campaigns.length > 1 && (
            <Field label="Move to campaign">
              <Select
                compact
                value=""
                disabled={pending}
                onChange={(e) =>
                  e.target.value &&
                  bulk({ action: "set_campaign", campaignId: e.target.value }, (d) =>
                    `${d.moved ?? 0} moved${d.skipped ? ` · ${d.skipped} skipped (already in that campaign)` : ""}`,
                  )
                }
                className="w-48"
              >
                <option value="">Choose…</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {rows.some((r) => chosen.includes(r.partnershipId) && r.clientApproval === "pending") && (
            <div className="self-center">
              <Button
                size="sm"
                icon={<Check size={13} />}
                pending={pending}
                title="Approve for outreach on the client's behalf — recorded under your name"
                onClick={() => bulk({ action: "approve" }, (d) => `${d.approved ?? 0} approved for outreach`)}
              >
                Approve for outreach
              </Button>
            </div>
          )}
          <div className="self-center">
            <Button
              size="sm"
              icon={<ImageDown size={13} />}
              pending={pending}
              title="Looks each one up on Instagram: profile picture, followers, and their public email if none is saved"
              onClick={() =>
                bulk({ action: "refresh_instagram" }, (d) => `Getting photos and followers for ${d.queued ?? 0} — they'll appear in a minute or two`)
              }
            >
              Get photos & followers
            </Button>
          </div>
          <div className="ml-auto self-center">
            <ConfirmButton
              label={`Delete ${chosen.length}`}
              icon={<Trash2 size={13} />}
              question={`Delete ${chosen.length} ${where}? Their conversation, shipping and videos there go too. Anyone not in another campaign is removed completely. This can't be undone.`}
              confirmLabel="Delete"
              pending={pending}
              onConfirm={() =>
                bulk({ action: "delete" }, (d) =>
                  `${d.removed ?? 0} removed${d.creatorsKept ? ` · ${d.creatorsKept} still in another campaign` : ""}${d.creatorsDeleted ? ` · ${d.creatorsDeleted} deleted completely` : ""}`,
                )
              }
            />
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold text-text-muted">
              <th className="w-10 px-4 py-2.5">
                <Checkbox
                  checked={all}
                  indeterminate={chosen.length > 0}
                  onChange={(on) => setSelected(on ? new Set(rows.map((r) => r.partnershipId)) : new Set())}
                  label={all ? "Clear selection" : "Select every creator shown"}
                />
              </th>
              <th className="px-4 py-2.5 font-semibold">Creator</th>
              {!scopeName && <th className="px-4 py-2.5 font-semibold">Campaign</th>}
              <th className="px-4 py-2.5 font-semibold">Stage</th>
              <th className="px-4 py-2.5 font-semibold">Where things stand</th>
              <th className="px-4 py-2.5 text-right font-semibold">Followers</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const on = selected.has(r.partnershipId);
              return (
                <tr key={r.partnershipId} className={on ? "bg-accent-soft/60" : "transition hover:bg-surface-2/60"}>
                  <td className="px-4 py-2.5">
                    <Checkbox checked={on} onChange={(v) => toggle(r.partnershipId, v)} label={`Select ${r.name}`} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={r.name} src={r.photoUrl} />
                      <div className="min-w-0">
                        <Link href={`/creators/${r.partnershipId}?returnTo=/creators`} className="font-medium text-text hover:text-accent">
                          {r.name}
                        </Link>
                        <div className="flex items-center gap-1.5 text-xs text-text-muted">
                          {r.profileUrl ? (
                            <a href={r.profileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-accent">
                              @{r.username}
                              <ExternalLink size={11} />
                            </a>
                          ) : (
                            <span>No profile link yet</span>
                          )}
                          {r.businessEmail && (
                            <span title={`Email tracked: ${r.businessEmail}`} aria-label="Email tracked">
                              <Mail size={11} />
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  {!scopeName && <td className="px-4 py-2.5 text-text-muted">{r.campaignName}</td>}
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1">
                      <StagePill stage={r.stage} />
                      {r.clientApproval === "pending" && r.stage === "shortlisted" && <Badge tone="warn">Awaiting approval</Badge>}
                    </div>
                  </td>
                  <td className="max-w-md px-4 py-2.5 text-text-muted">
                    <div className="flex items-start gap-1.5">
                      {r.whoseTurn === "us" && <Badge tone="warn">Your turn</Badge>}
                      <span className="line-clamp-2 min-w-0" title={r.standing.text}>
                        {r.standing.ours && <NotebookPen size={12} className="mr-1 inline align-[-1px] text-accent" />}
                        <span className={r.standing.ours ? "text-text" : undefined}>{r.standing.text}</span>
                        {r.standing.at && <span className="text-text-faint"> · {relativeDays(r.standing.at)}</span>}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">{compactNumber(r.followers)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
