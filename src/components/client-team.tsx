"use client";

import { useState } from "react";
import { Copy, Eye, Globe, KeyRound, Trash2, UserPlus, UserRound, UserX } from "lucide-react";
import { Badge, Button, Callout, Checkbox, Field, Input } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { api, useSave } from "@/components/use-save";
import { toast } from "@/components/toast";
import { shortDate } from "@/lib/format";

export interface ClientPerson {
  id: string;
  name: string;
  email: string;
  loginEnabled: boolean;
  hasPassword: boolean;
  /** ISO, when an invite link is open. */
  inviteExpiresAt: string | null;
  lastLoginAt: string | null;
}

/** Someone who wrote on this client's creators' threads that nobody has placed yet (src/lib/client-domains.ts). */
export interface ThreadStranger {
  email: string;
  name: string | null;
  domain: string;
  domainAllowed: boolean;
  messages: number;
  /** ISO. */
  lastAt: string;
  creatorNames: string[];
}

/**
 * Settings → Client team. Everyone here is a client contact for email (their
 * messages on a creator's thread show as the brand's, never as the creator or
 * us). "Invite to log in" makes a one-time link you send them yourself; they
 * choose their own password and see only this brand's portal.
 */
export function ClientTeam({
  clientId,
  clientName,
  people,
  requiresApproval,
  ourSideDomains = [],
  domains = [],
  strangers = [],
}: {
  clientId: string;
  clientName: string;
  people: ClientPerson[];
  requiresApproval: boolean;
  /** Whole domains on "Our side" — anyone there who isn't listed here still counts as us. */
  ourSideDomains?: string[];
  /** Whole domains at this client: everyone there counts as theirs. */
  domains?: { id: string; domain: string }[];
  strangers?: ThreadStranger[];
}) {
  const { pending, run, undoVia } = useSave();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [domain, setDomain] = useState("");

  const addDomain = async (d: string) => {
    const r = await run(() => api<{ domain?: string }>("/api/client-domains", { domain: d }), {
      success: `Everyone at @${d.trim().replace(/^@/, "").toLowerCase()} now counts as ${clientName}'s`,
    });
    if (r.ok) setDomain("");
  };
  const withCreator = (s: ThreadStranger) =>
    run(() => api("/api/thread-senders", { email: s.email }), {
      success: `${s.name ?? s.email} is with the creator`,
      undoWith: () => () => void undoVia("/api/thread-senders", { email: s.email, undo: true }, `Undone — ${s.name ?? s.email} is back on the list`),
    });
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);

  const add = async () => {
    const r = await run(() => api("/api/client-users", { name, email }), { success: `${name} added to ${clientName}'s team` });
    if (r.ok) {
      setName("");
      setEmail("");
    }
  };

  const invite = async (p: ClientPerson) => {
    const r = await run(() => api<{ url?: string }>("/api/client-users", { id: p.id, action: "invite" }, "PATCH"), { success: `Invite link ready for ${p.name}` });
    if (r.ok && r.data.url) setLink({ id: p.id, url: r.data.url });
  };

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm font-medium text-text">
        <Checkbox
          checked={requiresApproval}
          disabled={pending}
          onChange={(on) =>
            run(() => api(`/api/clients/${clientId}/settings`, { requiresApproval: on }, "PATCH"), {
              success: on ? `New creators now wait for ${clientName}'s approval` : "New creators go straight to To contact",
            })
          }
          label={`${clientName} approves each creator before anyone reaches out`}
        />
        {clientName} approves each creator before anyone reaches out
      </label>
      <p className="-mt-2 text-xs text-text-muted">
        {`New creators then wait in “Waiting on client approval” on Today. ${clientName} approves or passes in their portal, or you can for them. Creators already here aren't affected.`}
      </p>
      {(() => {
        const overlap = [...new Set(people.map((p) => p.email.split("@")[1]).filter((d) => ourSideDomains.includes(d)))];
        return overlap.length ? (
          <Callout tone="warn" title={`@${overlap.join(", @")} is also on Our side`}>
            People listed here count as {clientName}&apos;s either way, but anyone else at @{overlap.join(", @")} still counts as us. If they&apos;re
            all {clientName} staff, take the domain off Our side (Email tracking, above).
          </Callout>
        ) : null;
      })()}
      {people.length === 0 ? (
        <p className="text-sm text-text-muted">No one from {clientName} yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {people.map((p) => {
            const status = p.loginEnabled && p.hasPassword ? "login" : p.inviteExpiresAt ? "invited" : "contact";
            return (
              <li key={p.id} className="space-y-2 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-text">{p.name}</span>{" "}
                    <span className="break-all text-xs text-text-muted">{p.email}</span>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                      {status === "login" ? (
                        <Badge tone="good">Can sign in</Badge>
                      ) : status === "invited" ? (
                        <Badge tone="info">Invited · link open until {shortDate(p.inviteExpiresAt)}</Badge>
                      ) : (
                        <Badge tone="muted">Email contact only</Badge>
                      )}
                      {p.lastLoginAt && <span>last signed in {shortDate(p.lastLoginAt)}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {status !== "login" && (
                      <Button size="sm" icon={<KeyRound size={13} />} pending={pending} onClick={() => invite(p)}>
                        {status === "invited" ? "New invite link" : "Invite to log in"}
                      </Button>
                    )}
                    {status !== "contact" && (
                      <ConfirmButton
                        label="Turn off login"
                        icon={<UserX size={13} />}
                        pending={pending}
                        question={`${p.name} won't be able to sign in any more (they stay an email contact).`}
                        confirmLabel="Turn off"
                        onConfirm={() => run(() => api("/api/client-users", { id: p.id, action: "revoke" }, "PATCH"), { success: `${p.name} can no longer sign in` })}
                      />
                    )}
                    <ConfirmButton
                      label="Remove"
                      icon={<Trash2 size={13} />}
                      iconOnly
                      pending={pending}
                      question={`Remove ${p.name} from ${clientName}'s team? Their login stops working and their emails show as someone else's.`}
                      confirmLabel="Remove"
                      onConfirm={() => run(() => api("/api/client-users", { id: p.id }, "DELETE"), { success: `${p.name} removed` })}
                    />
                  </div>
                </div>
                {link?.id === p.id && (
                  <Callout tone="info" title="Send them this link yourself — it works once, for 7 days">
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <code className="break-all rounded bg-surface px-1.5 py-0.5 text-xs text-text">{link.url}</code>
                      <Button
                        size="sm"
                        icon={<Copy size={13} />}
                        onClick={async () => {
                          await navigator.clipboard.writeText(link.url).catch(() => undefined);
                          toast("Link copied", { tone: "good" });
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                    <p className="mt-1 text-xs">They choose their own password. It&apos;s shown only now — make a new one if it gets lost.</p>
                  </Callout>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Name">
          <Input compact value={name} onChange={(e) => setName(e.target.value)} placeholder="Rob Tinson" />
        </Field>
        <Field label="Email">
          <Input compact type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="rob@brand.com" />
        </Field>
        <Button size="sm" variant="primary" icon={<UserPlus size={13} />} pending={pending} disabled={!name.trim() || !email.trim()} onClick={add}>
          Add
        </Button>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <div>
          <div className="text-sm font-medium text-text">Whole domains</div>
          <p className="text-xs text-text-muted">
            Everyone writing from one of these counts as {clientName}&apos;s on {clientName}&apos;s creators — for an agency or partner that works for {clientName}.
          </p>
        </div>
        {domains.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {domains.map((d) => (
              <li key={d.id} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface py-0.5 pr-0.5 pl-2 text-sm text-text">
                @{d.domain}
                <ConfirmButton
                  label={`Remove @${d.domain}`}
                  icon={<Trash2 size={13} />}
                  iconOnly
                  pending={pending}
                  question={`Take @${d.domain} off ${clientName}'s team? Their emails show as someone else's again, unless the person is listed above.`}
                  confirmLabel={`Remove @${d.domain}`}
                  onConfirm={() => run(() => api("/api/client-domains", { id: d.id }, "DELETE"), { success: `@${d.domain} removed` })}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Add a domain">
            <Input compact value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="partner.com" className="w-56" />
          </Field>
          <Button size="sm" icon={<Globe size={13} />} pending={pending} disabled={!domain.trim()} onClick={() => addDomain(domain)}>
            Add domain
          </Button>
        </div>
      </div>

      {strangers.length > 0 && (
        <div className="space-y-2 border-t border-border pt-4">
          <div>
            <div className="text-sm font-medium text-text">Who are these?</div>
            <p className="text-xs text-text-muted">
              They wrote on {clientName}&apos;s creators&apos; threads and aren&apos;t on file. Saying whose side they&apos;re on keeps whose turn it is right.
            </p>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {strangers.map((s) => (
              <li key={s.email} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-text">{s.name ?? s.email}</span>{" "}
                  {s.name && <span className="break-all text-xs text-text-muted">{s.email}</span>}
                  <div className="mt-0.5 text-xs text-text-muted">
                    {`On ${s.creatorNames.join(", ")}'s thread${s.creatorNames.length === 1 ? "" : "s"} · ${s.messages === 1 ? "1 message" : `${s.messages} messages`} · last ${shortDate(s.lastAt)}`}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    size="sm"
                    icon={<UserPlus size={13} />}
                    pending={pending}
                    onClick={() =>
                      run(() => api("/api/client-users", { name: s.name ?? s.email.split("@")[0], email: s.email }), { success: `${s.name ?? s.email} added to ${clientName}'s team` })
                    }
                  >
                    {clientName}&apos;s team
                  </Button>
                  {s.domainAllowed && (
                    <Button size="sm" variant="ghost" icon={<Globe size={13} />} pending={pending} onClick={() => addDomain(s.domain)}>
                      All of @{s.domain}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<UserRound size={13} />} pending={pending} onClick={() => withCreator(s)}>
                    With the creator
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button size="sm" variant="ghost" icon={<Eye size={13} />} href="/portal">
        See what {clientName} sees
      </Button>
    </div>
  );
}
