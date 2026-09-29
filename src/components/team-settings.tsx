"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Badge, Button, Field, Input } from "@/components/ui";
import { api, useSave } from "@/components/use-save";

export interface TeamMemberView {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
  hasLogin: boolean;
}

/**
 * Settings → Team (owner, 2026-09-29): the people deals can be assigned to.
 * Nobody needs a login to be on it; when someone signs in with the email
 * given here, "Mine" shows their deals. Switching someone off keeps them as
 * owner of what they have, but they're no longer offered.
 */
export function TeamSettings({ members, meId }: { members: TeamMemberView[]; meId: string | null }) {
  const { pending, run } = useSave();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const add = async () => {
    const r = await run(() => api("/api/team", { name, email: email.trim() || null }), { success: `${name.trim().split(" ")[0]} is on the team` });
    if (r.ok) {
      setName("");
      setEmail("");
    }
  };

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {members.length === 0 && <li className="px-3 py-2.5 text-sm text-text-muted">Nobody yet — add yourself and your teammates below.</li>}
        {members.map((m) => (
          <TeamRow key={m.id} m={m} me={m.id === meId} />
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Name">
          <Input compact value={name} onChange={(e) => setName(e.target.value)} placeholder="Kieran Keliher-Burke" className="w-56" />
        </Field>
        <Field label="Email (optional)" hint="Their Sentic email — so 'Mine' works once they sign in.">
          <Input compact type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="kieran@sentic.io" className="w-56" />
        </Field>
        <Button size="sm" variant="primary" icon={<UserPlus size={13} />} pending={pending} disabled={!name.trim()} onClick={add}>
          Add to the team
        </Button>
      </div>
    </div>
  );
}

function TeamRow({ m, me }: { m: TeamMemberView; me: boolean }) {
  const { pending, run } = useSave();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(m.name);
  const [email, setEmail] = useState(m.email ?? "");

  const save = async (body: Record<string, unknown>, success: string) => {
    const r = await run(() => api("/api/team", { id: m.id, ...body }, "PATCH"), { success });
    if (r.ok) setEditing(false);
  };

  if (editing) {
    return (
      <li className="flex flex-wrap items-end gap-2 px-3 py-2.5">
        <Field label="Name">
          <Input compact value={name} onChange={(e) => setName(e.target.value)} className="w-56" />
        </Field>
        <Field label="Email">
          <Input compact type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-56" />
        </Field>
        <Button size="sm" variant="primary" pending={pending} disabled={!name.trim()} onClick={() => save({ name, email: email.trim() || null }, "Saved")}>
          Save
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
      <span className={m.active ? "font-medium text-text" : "font-medium text-text-faint line-through"}>{m.name}</span>
      {me && <Badge tone="info">You</Badge>}
      <span className="text-xs text-text-muted">{m.email ?? "no email"}</span>
      {m.hasLogin ? <Badge tone="good">Signs in</Badge> : <Badge tone="muted" title="Can own deals; 'Mine' works for them once they sign in with this email">No login yet</Badge>}
      {!m.active && <Badge tone="muted">Switched off</Badge>}
      <span className="ml-auto flex gap-1">
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          pending={pending}
          title={m.active ? "Keeps them as owner of what they have, but they're no longer offered" : "Offer them in the assign lists again"}
          onClick={() => save({ active: !m.active }, m.active ? `${m.name.split(" ")[0]} switched off` : `${m.name.split(" ")[0]} is back on the team`)}
        >
          {m.active ? "Switch off" : "Switch on"}
        </Button>
      </span>
    </li>
  );
}
