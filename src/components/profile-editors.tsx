"use client";

import { useState } from "react";
import { Pencil, Plus, X, Star, RefreshCw, ExternalLink, Trash2 } from "lucide-react";
import { PLATFORM_LABELS, ENRICHABLE_PLATFORMS, type SocialPlatform } from "@/lib/social-links";
import { parseAddress } from "@/lib/address";
import type { CmCreator, CmCreatorSocial, CmPartnership, CmProductRequested } from "@/lib/db/schema";
import { Button, IconButton, Field, Input, Textarea, Callout } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { api, useSave } from "@/components/use-save";
import { toast } from "@/components/toast";

/* ── Identity ─────────────────────────────────────────────────── */

export function EditableProfile({ creator }: { creator: CmCreator }) {
  const { pending, run } = useSave();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(creator.name);
  const [email, setEmail] = useState(creator.businessEmail ?? "");
  const [pillar, setPillar] = useState(creator.contentPillar ?? "");
  const [followers, setFollowers] = useState(creator.followers?.toString() ?? "");
  const [notes, setNotes] = useState(creator.notes ?? "");
  const canRefresh = ENRICHABLE_PLATFORMS.includes(creator.platform as SocialPlatform);

  const save = async () => {
    const r = await run(
      () =>
        api(
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
      { success: "Profile saved" },
    );
    if (r.ok) setOpen(false);
  };

  const refresh = async () => {
    const r = await run(() => api<{ followers?: number }>("/api/enrich", { creatorId: creator.id, save: true }), {
      success: "Picture, followers and public email refreshed from Instagram",
    });
    if (r.ok && r.data.followers != null) setFollowers(String(r.data.followers));
  };

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setOpen(true)}>
          Edit profile
        </Button>
        {canRefresh && (
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={13} />}
            pending={pending}
            onClick={refresh}
            title="Pulls the current follower count and public email from the Instagram profile"
          >
            Refresh from Instagram
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-2/60 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input compact value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Contact email" hint="The public one. Other addresses they write from are linked separately.">
          <Input compact value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
        </Field>
        <Field label="Content type" hint="What they post — overlanding, DIY, shop builds.">
          <Input compact value={pillar} onChange={(e) => setPillar(e.target.value)} />
        </Field>
        <Field label="Followers" hint="Manual edits stay until the next refresh.">
          <Input
            compact
            value={followers}
            onChange={(e) => setFollowers(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
          />
        </Field>
      </div>
      <Field label="Notes about the creator (all campaigns)">
        <Textarea compact value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={save} pending={pending}>
          Save profile
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ── Email addresses ──────────────────────────────────────────── */

/**
 * Every address this creator is known to use. The public (scraped) address
 * is shown on the profile; these extras are what the email sync also
 * matches — the address a creator actually replies from is usually not the
 * public one.
 */
export function EmailsEditor({
  creatorId,
  emails,
}: {
  creatorId: string;
  emails: { id: string; email: string; source: string }[];
}) {
  const { pending, run } = useSave();
  const [value, setValue] = useState("");
  const [missing, setMissing] = useState(false);

  const add = async () => {
    if (!value.trim()) return setMissing(true);
    const r = await run(() => api(`/api/creators/${creatorId}/emails`, { email: value }), {
      success: "Email added — their last 6 months of email is being checked now",
    });
    if (r.ok) setValue("");
  };
  const remove = (email: string) =>
    run(() => api(`/api/creators/${creatorId}/emails`, { email }, "DELETE"), { success: "Email unlinked" });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {emails.map((e) => (
        <span
          key={e.id}
          className="inline-flex items-center gap-1 rounded-md bg-surface-2 py-0.5 pr-0.5 pl-2 text-xs text-text-muted ring-1 ring-inset ring-border"
          title={e.source === "sync" ? "Linked from an email thread" : "Added by hand"}
        >
          {e.email}
          <ConfirmButton
            iconOnly
            icon={<X size={11} />}
            label={`Unlink ${e.email}`}
            question={`Stop tracking ${e.email}?`}
            confirmLabel="Stop tracking"
            pending={pending}
            onConfirm={() => remove(e.email)}
          />
        </span>
      ))}
      <Input
        compact
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setMissing(false);
        }}
        onKeyDown={(e) => e.key === "Enter" && add()}
        placeholder="Another email they write from"
        aria-label="Another email they write from"
        className="w-56"
        type="email"
        invalid={missing}
        aria-describedby={missing ? `${creatorId}-email-missing` : undefined}
      />
      <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={add} pending={pending}>
        Link email
      </Button>
      {missing && (
        <span id={`${creatorId}-email-missing`} role="alert" className="basis-full text-xs text-bad">
          Type the email address first.
        </span>
      )}
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
  const { pending, run } = useSave();
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");

  const [missing, setMissing] = useState(false);
  const add = async () => {
    if (!url.trim()) return setMissing(true);
    const r = await run(() => api(`/api/creators/${creatorId}/socials`, { url }), { success: "Link added" });
    if (r.ok) {
      setUrl("");
      setAdding(false);
    }
  };

  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-1.5">
        {socials.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-0.5 rounded-full border border-border bg-surface py-0.5 pr-0.5 pl-2.5 text-xs"
          >
            {s.isPrimary && <Star size={10} className="mr-0.5 fill-warn-line text-warn" aria-label="Primary link" />}
            <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-text-muted hover:text-accent">
              {PLATFORM_LABELS[s.platform as SocialPlatform]}
              {s.handle ? ` · @${s.handle}` : ""}
              <ExternalLink size={9} className="text-text-faint" />
            </a>
            {!s.isPrimary && (
              <>
                <IconButton
                  label="Make this the primary link"
                  icon={<Star size={11} />}
                  disabled={pending}
                  onClick={() =>
                    run(() => api(`/api/creators/${creatorId}/socials`, { socialId: s.id, makePrimary: true }), {
                      success: "Primary link changed — the profile now points here",
                    })
                  }
                />
                <ConfirmButton
                  iconOnly
                  icon={<X size={11} />}
                  label="Remove link"
                  question="Remove this profile link?"
                  confirmLabel="Remove link"
                  pending={pending}
                  onConfirm={() =>
                    run(() => api(`/api/creators/${creatorId}/socials`, { socialId: s.id }, "DELETE"), {
                      success: "Link removed",
                    })
                  }
                />
              </>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            compact
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setMissing(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Paste another profile link"
            aria-label="Profile link"
            className="max-w-sm"
            autoFocus
            invalid={missing}
            aria-describedby={missing ? `${creatorId}-link-missing` : undefined}
          />
          <Button size="sm" variant="primary" onClick={add} pending={pending}>
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          {missing && (
            <span id={`${creatorId}-link-missing`} role="alert" className="basis-full text-xs text-bad">
              Paste the profile link first.
            </span>
          )}
        </div>
      ) : (
        <Button variant="link" icon={<Plus size={13} />} onClick={() => setAdding(true)} className="text-xs">
          Add a profile link
        </Button>
      )}
    </div>
  );
}

/* ── Shipping address ─────────────────────────────────────────── */

export function AddressEditor({
  partnership,
  suggested,
}: {
  partnership: CmPartnership;
  /** An address the creator wrote in an email — offered as one click. */
  suggested?: { text: string; when: string | null } | null;
}) {
  const { pending, run } = useSave();
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [parseIssues, setParseIssues] = useState<string[]>([]);
  const [raw, setRaw] = useState(partnership.addressRaw ?? "");
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

  // The DM almost always contains the address as one block — read it instead
  // of retyping six fields. Anything ambiguous is surfaced, never guessed.
  const parsePasted = (text: string = paste) => {
    const parsed = parseAddress(text);
    if (!parsed) {
      setParseIssues(["Couldn't read that — fill the fields in by hand."]);
      return;
    }
    setF({
      recipientName: parsed.recipientName ?? "",
      addressLine1: parsed.addressLine1 ?? "",
      addressLine2: parsed.addressLine2 ?? "",
      city: parsed.city ?? "",
      region: parsed.region ?? "",
      postalCode: parsed.postalCode ?? "",
      country: parsed.country || "US",
    });
    setRaw(parsed.raw);
    setParseIssues(parsed.issues.map((i) => `Couldn't find the ${i.replace(/^no /, "")} — check the fields below.`));
    if (parsed.isComplete) toast("Address read — check it, then save", { tone: "good" });
  };

  const save = async () => {
    const r = await run(
      () =>
        api(
          `/api/partnerships/${partnership.id}`,
          {
            ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || null])),
            addressRaw: raw || null,
          },
          "PATCH",
        ),
      { success: "Address saved" },
    );
    if (r.ok) setOpen(false);
  };

  if (!open) {
    const offer = suggested && !partnership.addressLine1 ? suggested : null;
    return (
      <div className="space-y-2">
        {offer && (
          <Callout
            tone="info"
            title={`Address found in their email${offer.when ? ` (${offer.when})` : ""}`}
            actions={
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setPaste(offer.text);
                  parsePasted(offer.text);
                  setOpen(true);
                }}
              >
                Use it
              </Button>
            }
          >
            <span className="whitespace-pre-wrap">{offer.text}</span>
          </Callout>
        )}
        <Button size="sm" icon={<Pencil size={13} />} onClick={() => setOpen(true)}>
          {partnership.addressLine1 ? "Edit address" : "Add address"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-2/60 p-3">
      <Field label="Paste the address as they sent it" hint="One line or several — it's read into the fields below.">
        <div className="flex gap-2">
          <Textarea
            compact
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={3}
            placeholder={"Joe Hubbard\n3333 Simeon Bunker St\nSaint Charles, MO 63301"}
          />
          <Button size="sm" onClick={() => (paste.trim() ? parsePasted() : setParseIssues(["Paste the address first — as they sent it."]))} className="self-start">
            Read it
          </Button>
        </div>
      </Field>
      {parseIssues.length > 0 && <Callout tone="warn">{parseIssues.join(" ")}</Callout>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Recipient name">
          <Input compact value={f.recipientName} onChange={(e) => set("recipientName", e.target.value)} />
        </Field>
        <Field label="Street address">
          <Input compact value={f.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} />
        </Field>
        <Field label="Apt, suite (optional)">
          <Input compact value={f.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} />
        </Field>
        <Field label="City">
          <Input compact value={f.city} onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label="State">
          <Input compact value={f.region} onChange={(e) => set("region", e.target.value)} />
        </Field>
        <Field label="ZIP">
          <Input compact value={f.postalCode} onChange={(e) => set("postalCode", e.target.value)} />
        </Field>
        <Field label="Country">
          <Input compact value={f.country} onChange={(e) => set("country", e.target.value)} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={save} pending={pending}>
          Save address
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
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
  const { pending, run } = useSave();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [qty, setQty] = useState("1");
  const [missing, setMissing] = useState(false);

  const add = async () => {
    if (!name.trim()) return setMissing(true);
    const r = await run(
      () =>
        api("/api/products", {
          partnershipId,
          productName: name.trim(),
          productUrl: url.trim() || null,
          quantity: Number(qty) || 1,
        }),
      { success: "Product added" },
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
      {products.length === 0 && !open && <p className="text-sm text-text-muted">No product agreed yet.</p>}
      {products.length > 0 && (
        <ul className="space-y-1.5">
          {products.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-2 text-sm">
              <div className="min-w-0">
                {p.productUrl ? (
                  <a href={p.productUrl} target="_blank" rel="noreferrer" className="font-medium text-text hover:text-accent">
                    {p.productName}
                  </a>
                ) : (
                  <span className="font-medium text-text">{p.productName}</span>
                )}
                <div className="text-xs text-text-muted">
                  {p.category && <span>{p.category}</span>}
                  {p.quantity > 1 && <span>{p.category ? " · " : ""}qty {p.quantity}</span>}
                </div>
              </div>
              <ConfirmButton
                iconOnly
                icon={<Trash2 size={13} />}
                label="Remove product"
                question="Remove this product?"
                confirmLabel="Remove product"
                pending={pending}
                onConfirm={() => run(() => api("/api/products", { id: p.id }, "DELETE"), { success: "Product removed" })}
              />
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="space-y-2 rounded-lg border border-border bg-surface-2/60 p-3">
          <Field label="Product" error={missing ? "Name the product first." : undefined}>
            <Input
              compact
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setMissing(false);
              }}
              placeholder="Rallye 4000 driving lights"
              autoFocus
            />
          </Field>
          <Field label="Link (optional)">
            <Input compact value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Quantity" className="w-24">
            <Input compact value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={add} pending={pending}>
              Add product
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" icon={<Plus size={13} />} onClick={() => setOpen(true)}>
          Add product
        </Button>
      )}
    </div>
  );
}
