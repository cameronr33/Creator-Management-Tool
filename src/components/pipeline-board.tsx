"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { STAGES, stageStyle } from "@/lib/stages";
import type { CmStage } from "@/lib/db/schema";
import { compactNumber } from "@/lib/format";

export interface BoardCard {
  partnershipId: string;
  name: string;
  username: string;
  followers: number | null;
  stage: CmStage;
  agreementType: string | null;
}

// Active stages get their own column; the three terminal stages collapse into
// one "Closed" column so the board stays about live work.
const COLUMNS: { key: string; label: string; stages: CmStage[] }[] = [
  ...STAGES.filter((s) => !s.terminal).map((s) => ({ key: s.value, label: s.label, stages: [s.value] as CmStage[] })),
  { key: "closed", label: "Closed", stages: ["passed", "declined", "no_response"] as CmStage[] },
];

export function PipelineBoard({ cards }: { cards: BoardCard[] }) {
  const router = useRouter();
  const [items, setItems] = useState(cards);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const move = async (partnershipId: string, toStage: CmStage) => {
    const card = items.find((c) => c.partnershipId === partnershipId);
    if (!card || card.stage === toStage) return;
    // Optimistic.
    setItems((prev) => prev.map((c) => (c.partnershipId === partnershipId ? { ...c, stage: toStage } : c)));
    const res = await fetch(`/api/partnerships/${partnershipId}/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: toStage }),
    });
    if (res.ok) router.refresh();
    else setItems(cards); // revert on failure
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {COLUMNS.map((col) => {
        const colCards = items.filter((c) => col.stages.includes(c.stage));
        const dropStage = col.stages[0];
        return (
          <div
            key={col.key}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(col.key);
            }}
            onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
            onDrop={() => {
              if (dragId) move(dragId, dropStage);
              setDragId(null);
              setOverCol(null);
            }}
            className={`flex w-64 shrink-0 flex-col rounded-xl border bg-surface-2/50 transition ${
              overCol === col.key ? "border-accent ring-1 ring-accent" : "border-border"
            }`}
          >
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">{col.label}</span>
              <span className="rounded-full bg-surface px-1.5 text-xs font-semibold tabular text-text-faint">
                {colCards.length}
              </span>
            </div>
            <div className="flex min-h-16 flex-col gap-2 px-2 pb-2">
              {colCards.map((c) => (
                <div
                  key={c.partnershipId}
                  draggable
                  onDragStart={() => setDragId(c.partnershipId)}
                  onDragEnd={() => setDragId(null)}
                  className={`cursor-grab rounded-lg border border-border bg-surface p-2.5 shadow-sm transition active:cursor-grabbing ${
                    dragId === c.partnershipId ? "opacity-50" : ""
                  }`}
                >
                  <Link href={`/creators/${c.partnershipId}`} className="block">
                    <div className="truncate text-sm font-medium text-text hover:text-accent">{c.name}</div>
                    <div className="mt-0.5 flex items-center justify-between text-xs text-text-faint">
                      <span className="truncate">@{c.username}</span>
                      <span className="tabular">{compactNumber(c.followers)}</span>
                    </div>
                    {c.agreementType && col.key === "closed" && (
                      <span className={`mt-1 inline-block rounded px-1 text-[10px] ring-1 ring-inset ${stageStyle(c.stage)}`}>
                        {c.stage.replace("_", " ")}
                      </span>
                    )}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
