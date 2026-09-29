"use client";

import { useState } from "react";
import { NotebookPen, Pencil } from "lucide-react";
import { Button, IconButton, Textarea } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import { relativeDays } from "@/lib/format";
import type { StatusNoteView } from "@/lib/status-note";

/**
 * Our own note on where things stand — a sentence or two, beside the line the
 * email reader writes. Edited in place wherever it shows (creator page, Today,
 * Pipeline); the email reader never overwrites it.
 */
export function StatusNote({
  partnershipId,
  note,
  compact = false,
  editing: editingProp,
  onEditingChange,
  hideWhenEmpty = false,
}: {
  partnershipId: string;
  note: StatusNoteView | null;
  compact?: boolean;
  /** Controlled from outside (a row's ⋯ menu opens it). */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  /** No "Note where things stand" link when there's no note — the row's menu offers it instead. */
  hideWhenEmpty?: boolean;
}) {
  const { pending, run } = useSave();
  const [editingOwn, setEditingOwn] = useState(false);
  const editing = editingProp ?? editingOwn;
  const setEditing = (v: boolean) => {
    setEditingOwn(v);
    onEditingChange?.(v);
  };
  const [draft, setDraft] = useState(note?.text ?? "");

  const save = async (text: string) => {
    const r = await run(() => api(`/api/partnerships/${partnershipId}`, { statusNote: text.trim() || null }, "PATCH"), { success: text.trim() ? "Saved where things stand" : "Removed" });
    if (r.ok) setEditing(false);
  };

  if (editing) {
    return (
      <div className="space-y-1.5">
        <Textarea
          compact={compact}
          rows={compact ? 3 : 2}
          maxLength={600}
          autoFocus
          aria-label="Where things stand"
          placeholder="Where things stand — e.g. waiting on HELLA for wiper part numbers; she's fine with the delay."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(draft);
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="primary" pending={pending} onClick={() => save(draft)}>
            Save
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
            Cancel
          </Button>
          {note && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => save("")}>
              Remove
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!note) {
    if (hideWhenEmpty) return null;
    return (
      <Button
        variant="link"
        className="!text-xs text-text-faint"
        icon={<NotebookPen size={compact ? 11 : 12} />}
        onClick={() => {
          setDraft("");
          setEditing(true);
        }}
      >
        Note where things stand
      </Button>
    );
  }

  return (
    <div className={compact ? "flex items-start gap-1 text-xs leading-snug" : "flex items-start gap-1.5 text-sm"}>
      <NotebookPen size={compact ? 11 : 13} className="mt-[3px] shrink-0 text-accent" />
      <p className={compact ? "line-clamp-4 min-w-0 flex-1 text-text" : "min-w-0 flex-1 text-text"} title={`Where things stand: ${note.text}`}>
        {note.text}
        <span className="text-text-faint">
          {" "}
          · {note.by ? `${note.by.split(" ")[0]}, ` : ""}
          {relativeDays(note.at)}
        </span>
      </p>
      <IconButton
        label="Edit where things stand"
        icon={<Pencil size={compact ? 11 : 12} />}
        onClick={() => {
          setDraft(note.text);
          setEditing(true);
        }}
      />
    </div>
  );
}
