"use client";

import { useMemo, useRef, useState } from "react";
import { Copy, Check, Send, Mail, MessageCircle, ExternalLink } from "lucide-react";
import { Button, Field, Input, Textarea, Segmented, Callout } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import { toast } from "@/components/toast";
import { renderTemplate, firstName, igDmUrl, igProfileUrl, mailtoUrl, unfilledPlaceholders } from "@/lib/outreach";

/**
 * The one message composer, used on the Outreach list and on a creator's
 * record so both work the same way:
 *
 *   1. (optional) one line about their content → fills {{reason}}
 *   2. Copy & open  → copies the message, opens Instagram or the mail app
 *   3. I sent it     → logs the message on the timeline (stage moves itself)
 *
 * Step 3 becomes the highlighted button once step 2 has happened, so the
 * order is visible instead of remembered. Copying is blocked while the
 * message still has an unfilled [placeholder].
 */

export interface ComposerTemplate {
  subject: string | null;
  body: string;
}

export interface ComposerTemplates {
  ig_dm: ComposerTemplate | null;
  email: ComposerTemplate | null;
  /** The connected sync mailbox — pre-filled as cc so email threads get tracked. */
  ccEmail?: string | null;
}

export interface ComposerTarget {
  partnershipId: string;
  name: string;
  username: string;
  businessEmail: string | null;
  contentPillar: string | null;
  outreachReason: string | null;
}

type Channel = "ig_dm" | "email";

const REASON_RE = /\{\{\s*reason\s*\}\}/;

export function MessageComposer({
  target,
  templates,
  kind,
  onLogged,
}: {
  target: ComposerTarget;
  templates: ComposerTemplates;
  /** What "I sent it" records — a first message or a follow-up. */
  kind: "initial" | "follow_up";
  onLogged?: () => void;
}) {
  const { pending, run } = useSave();
  const emailAvailable = !!target.businessEmail && !!templates.email;
  const [channel, setChannel] = useState<Channel>(templates.ig_dm || !emailAvailable ? "ig_dm" : "email");
  const [reason, setReason] = useState(target.outreachReason ?? "");
  const [savedReason, setSavedReason] = useState(target.outreachReason ?? "");
  // null = follow the template; a string = the operator hand-edited the message.
  const [override, setOverride] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);
  // The reason field only turns red after a copy was attempted without it —
  // a form that opens already shouting is one nobody reads.
  const [attempted, setAttempted] = useState(false);
  const reasonRef = useRef<HTMLInputElement>(null);

  const template = templates[channel];
  const vars = useMemo(
    () => ({
      name: firstName(target.name),
      content_descriptor: target.contentPillar ?? "content",
      reason,
    }),
    [target.name, target.contentPillar, reason],
  );
  const rendered = template ? renderTemplate(template.body, vars) : "";
  const message = override ?? rendered;
  const subject = template?.subject ? renderTemplate(template.subject, vars) : null;
  const usesReason = REASON_RE.test(template?.body ?? "") || REASON_RE.test(template?.subject ?? "");
  const missing = unfilledPlaceholders(`${subject ?? ""}\n${message}`);

  const persistReason = async () => {
    const trimmed = reason.trim();
    if (trimmed === savedReason) return;
    const r = await run(
      () => api(`/api/partnerships/${target.partnershipId}`, { outreachReason: trimmed || null }, "PATCH"),
      { refresh: false },
    );
    if (r.ok) setSavedReason(trimmed);
  };

  const copyAndOpen = async () => {
    if (!message) return;
    if (missing.length) {
      setAttempted(true);
      if (missing.includes("reason")) reasonRef.current?.focus();
      toast(`Fill in ${missing.map((m) => `[${m}]`).join(", ")} before copying`, { tone: "bad" });
      return;
    }
    await navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    setOpened(true);
    if (channel === "ig_dm") {
      window.open(igDmUrl(target.username), "_blank", "noopener");
    } else if (target.businessEmail) {
      window.open(mailtoUrl(target.businessEmail, subject, message, templates.ccEmail), "_self");
    }
  };

  const markSent = async () => {
    const r = await run(
      () =>
        api("/api/outreach", {
          partnershipId: target.partnershipId,
          direction: "outbound",
          channel,
          kind,
          body: message || undefined,
          subject: channel === "email" && subject ? subject : undefined,
        }),
      { success: `Logged ${kind === "initial" ? "first message" : "follow-up"} to ${target.name}` },
    );
    if (r.ok) {
      setOpened(false);
      onLogged?.();
    }
  };

  const openLabel = channel === "ig_dm" ? "Copy & open Instagram" : "Copy & open email";

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {emailAvailable ? (
          <Segmented<Channel>
            aria-label="Channel"
            value={channel}
            onChange={(c) => {
              setChannel(c);
              setOverride(null);
              setOpened(false);
            }}
            options={[
              { value: "ig_dm", label: (<><MessageCircle size={12} /> Instagram DM</>) },
              { value: "email", label: (<><Mail size={12} /> Email</>), title: target.businessEmail ?? undefined },
            ]}
          />
        ) : (
          <span className="text-xs text-text-faint">
            Instagram DM{target.businessEmail ? "" : " · no email on file"}
          </span>
        )}
        <a
          href={igProfileUrl(target.username)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-accent"
        >
          @{target.username} <ExternalLink size={11} />
        </a>
      </div>

      {template ? (
        <>
          {usesReason && (
            <Field
              label="Why them? One line about their content — it goes into the message"
              hint={
                missing.includes("reason")
                  ? "Replaces [reason] in the message. Saved for next time when you click away."
                  : "Saved for next time as soon as you click away."
              }
              error={attempted && missing.includes("reason") ? "The message still says [reason] — fill this in first." : undefined}
            >
              <Input
                ref={reasonRef}
                compact
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onBlur={persistReason}
                invalid={attempted && missing.includes("reason")}
                placeholder='e.g. "loved your brake-swap reel"'
              />
            </Field>
          )}
          {channel === "email" && subject && (
            <div className="text-xs text-text-muted">
              <span className="font-medium text-text">Subject:</span> {subject}
              {templates.ccEmail && (
                <span className="text-text-faint"> · cc {templates.ccEmail} (so replies get tracked)</span>
              )}
            </div>
          )}
          <Field
            label="Message"
            hint={
              override !== null ? (
                <button type="button" onClick={() => setOverride(null)} className="text-accent hover:underline">
                  Reset to the template
                </button>
              ) : (
                "Edit freely — this exact text is what gets logged."
              )
            }
          >
            <Textarea
              value={message}
              onChange={(e) => setOverride(e.target.value)}
              rows={Math.min(10, Math.max(4, message.split("\n").length + 1))}
              className="bg-surface-2/60"
            />
          </Field>
          {attempted && missing.filter((m) => m !== "reason").length > 0 && (
            <Callout tone="warn">
              The message still contains{" "}
              {missing
                .filter((m) => m !== "reason")
                .map((m) => `[${m}]`)
                .join(", ")}
              . Edit it before copying.
            </Callout>
          )}
        </>
      ) : (
        <Callout tone="info">
          No default {channel === "email" ? "email" : "DM"} template for this client yet —{" "}
          <a href="/settings#templates" className="font-medium underline">
            add one in Settings
          </a>
          . You can still log a message you wrote yourself.
        </Callout>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {template && (
          <Button
            variant={opened ? "secondary" : "primary"}
            onClick={copyAndOpen}
            disabled={!message}
            icon={copied ? <Check size={14} /> : <Copy size={14} />}
            title="Copies the message and opens the app"
          >
            {copied ? "Copied" : openLabel}
          </Button>
        )}
        <Button
          variant={opened || !template ? "primary" : "secondary"}
          onClick={markSent}
          pending={pending}
          icon={<Send size={14} />}
          title="Records this message on the timeline. Do this after you've actually sent it."
        >
          I sent it
        </Button>
        {opened && <span className="text-xs text-text-muted">Sent it? Log it so the follow-up clock starts.</span>}
      </div>
    </div>
  );
}
