"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, X, Star, Sparkles, Loader2, ExternalLink, Trash2 } from "lucide-react";
import { PLATFORM_LABELS, type SocialPlatform } from "@/lib/social-links";
import type { CmCreator, CmCreatorSocial, CmPartnership, CmProductRequested } from "@/lib/db/schema";

async function send(url: string, body: unknown, method = "POST") {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.ok !== false, data };
}

function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const run = async (fn: () => Promise<{ ok: boolean; data: unknown }>) => {
    setPending(true);
    const r = await fn();
    setPending(false);
    if (r.ok) router.refresh();
    return r;
  };
  return { pending, run };
}

const input =
  "w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent";

/* ── Identity ─────────────────────────────────────────────────── */

export function EditableProfile({ creator }: { creator: CmCreator }) {
  const { pending, run } = useAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(creator.name);
  const [email, setEmail] = useState(creator.businessEmail ?? "");
  const [pillar, setPillar] = useState(creator.contentPillar ?? "");
  const [followers, setFollowers] = useState(creator.followers?.toString() ?? "");
  const [notes, setNotes] = useState(creator.notes ?? "");
  const [fetchNote, setFetchNote] = useState<string | null>(null);

  const save = async () => {
    const r = await run(() =>
      send(
        `/api/creators/${creator.id}`,
        {
          name: name.trim() || creator.name,
          businessEmail: email || null,
          contentPillar: pillar || null,
          followers: followers ? Number(followers) : null,
          notes: notes || null,
        },
        "PATCH",
      ),
    );
    if (r.ok) setOpen(false);
  };

  const fetchDetails = async () => {
    setFetchNote(null);
    const r = await run(() => send("/api/enrich", { creatorId: creator.id, save: true }));
    const d = r.data as { ok?: boolean; error?: string; followers?: number };
    if (d?.ok) {
      if (d.followers != null) setFollowers(String(d.followers));
      setFetchNote("Refreshed from the profile.");
    } else {
      setFetchNote(d?.error ?? "Could not fetch.");
    }
  };

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 text-xs text-text-muted transition hover:text-accent"
        >
          <Pencil size={12} /> Edit profile
        </button>
        <button
          onClick={fetchDetails}
          disabled={pending}
          className="flex items-center gap-1 text-xs text-text-muted transition hover:text-accent disabled:opacity-60"
        >
          {pending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Fetch
        </button>
        {fetchNote && <span className="text-xs text-text-faint">{fetchNote}</span>}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border bg-surface-2 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={input} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Contact email" className={input} />
        <input value={pillar} onChange={(e) => setPillar(e.target.value)} placeholder="Content pillar" className={input} />
        <input
          value={followers}
          onChange={(e) => setFollowers(e.target.value.replace(/[^\d]/g, ""))}
          placeholder="Followers"
          inputMode="numeric"
          className={input}
        />
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Notes about this creator…"
        className={input}
      />
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          Save
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-text-muted hover:bg-surface">
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ── Social links ─────────────────────────────────────────────── */

export function SocialsEditor({
  creatorId,
  socials,
}: {
  creatorId: string;
  socials: CmCreatorSocial[];
}) {
  const { pending, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    const r = await run(() => send(`/api/creators/${creatorId}/socials`, { url }));
    if (r.ok) {
      setUrl("");
      setAdding(false);
    } else {
      setError((r.data as { error?: string })?.error ?? "Could not add that link.");
    }
  };

  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-1.5">
        {socials.map((s) => (
          <li
            key={s.id}
            className="group flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs"
          >
            {s.isPrimary && <Star size={10} className="fill-amber-400 text-amber-400" />}
            <a href={s.url} target="_blank" rel="noreferrer" className="text-text-muted hover:text-accent">
              {PLATFORM_LABELS[s.platform as SocialPlatform]}
              {s.handle ? ` · @${s.handle}` : ""}
            </a>
            <ExternalLink size={9} className="text-text-faint" />
            {!s.isPrimary && (
              <>
                <button
                  onClick={() => run(() => send(`/api/creators/${creatorId}/socials`, { socialId: s.id, makePrimary: true }))}
                  disabled={pending}
                  title="Make primary"
                  className="opacity-0 transition group-hover:opacity-100 hover:text-amber-500"
                >
                  <Star size={10} />
                </button>
                <button
                  onClick={() => run(() => send(`/api/creators/${creatorId}/socials`, { socialId: s.id }, "DELETE"))}
                  disabled={pending}
                  title="Remove"
                  className="opacity-0 transition group-hover:opacity-100 hover:text-red-600"
                >
                  <X size={10} />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="flex items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste another profile link"
            className={`${input} max-w-sm`}
          />
          <button
            onClick={add}
            disabled={pending || !url.trim()}
            className="rounded-lg bg-accent px-2.5 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
          >
            Add
          </button>
          <button onClick={() => setAdding(false)} className="text-sm text-text-muted hover:text-text">
            Cancel
          </button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-xs text-accent hover:underline">
          <Plus size={12} /> Add link
        </button>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/* ── Shipping address ─────────────────────────────────────────── */

export function AddressEditor({ partnership }: { partnership: CmPartnership }) {
  const { pending, run } = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    recipientName: partnership.recipientName ?? "",
    addressLine1: partnership.addressLine1 ?? "",
    addressLine2: partnership.addressLine2 ?? "",
    city: partnership.city ?? "",
    region: partnership.region ?? "",
    postalCode: partnership.postalCode ?? "",
    country: partnership.country ?? "US",
  });
  const set = (k: keyof typeof f, v: string) => setF((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    const r = await run(() =>
      send(
        `/api/partnerships/${partnership.id}`,
        Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || null])),
        "PATCH",
      ),
    );
    if (r.ok) setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs text-accent hover:underline"
      >
        <Pencil size={12} /> {partnership.addressLine1 ? "Edit address" : "Add address"}
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border bg-surface-2 p-3">
      <input value={f.recipientName} onChange={(e) => set("recipientName", e.target.value)} placeholder="Recipient name" className={input} />
      <input value={f.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} placeholder="Street address" className={input} />
      <input value={f.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} placeholder="Apt, suite (optional)" className={input} />
      <div className="grid grid-cols-3 gap-2">
        <input value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="City" className={input} />
        <input value={f.region} onChange={(e) => set("region", e.target.value)} placeholder="State" className={input} />
        <input value={f.postalCode} onChange={(e) => set("postalCode", e.target.value)} placeholder="ZIP" className={input} />
      </div>
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          Save address
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-text-muted hover:bg-surface">
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ── Products ─────────────────────────────────────────────────── */

export function ProductEditor({
  partnershipId,
  products,
}: {
  partnershipId: string;
  products: CmProductRequested[];
}) {
  const { pending, run } = useAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [qty, setQty] = useState("1");

  const add = async () => {
    const r = await run(() =>
      send("/api/products", {
        partnershipId,
        productName: name.trim(),
        productUrl: url.trim() || null,
        quantity: Number(qty) || 1,
      }),
    );
    if (r.ok) {
      setName("");
      setUrl("");
      setQty("1");
      setOpen(false);
    }
  };

  return (
    <div className="space-y-2">
      {products.length > 0 && (
        <ul className="space-y-1.5">
          {products.map((p) => (
            <li key={p.id} className="group flex items-start justify-between gap-2 text-sm">
              <div className="min-w-0">
                {p.productUrl ? (
                  <a href={p.productUrl} target="_blank" rel="noreferrer" className="font-medium text-text hover:text-accent">
                    {p.productName}
                  </a>
                ) : (
                  <span className="font-medium text-text">{p.productName}</span>
                )}
                <div className="text-xs text-text-faint">
                  {p.category && <span>{p.category}</span>}
                  {p.quantity > 1 && <span>{p.category ? " · " : ""}qty {p.quantity}</span>}
                </div>
              </div>
              <button
                onClick={() => run(() => send("/api/products", { id: p.id }, "DELETE"))}
                disabled={pending}
                className="shrink-0 opacity-0 transition group-hover:opacity-100 hover:text-red-600"
                title="Remove product"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-2.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name" className={input} />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Product URL (optional)" className={input} />
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="Qty"
            inputMode="numeric"
            className={`${input} w-20`}
          />
          <div className="flex gap-2">
            <button
              onClick={add}
              disabled={pending || !name.trim()}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
            >
              Add
            </button>
            <button onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-text-muted hover:bg-surface">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-xs text-accent hover:underline">
          <Plus size={12} /> Add product
        </button>
      )}
    </div>
  );
}
