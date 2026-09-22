"use client";

import { useMemo, useRef, useState } from "react";
import { Copy, Check, Send, Mail, MessageCircle, ExternalLink } from "lucide-react";
import { Button, Field, Input, Textarea, Segmented, Callout } from "@/components/ui";
import { api, useSave } from "@/components/use-save";
import { toast } from "@/components/toast";
import { renderTemplate, firstName, igDmUrl, igProfileUrl, mailtoUrl, unfilledPlaceholders } from "@/lib/outreach";
import { selectMessageTemplate, validateMessageDraft } from "@/lib/message-draft";

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
  const emailAvailable = !!target.businessEmail;
  const [channel, setChannel] = useState<Channel>(templates.ig_dm || !emailAvailable ? "ig_dm" : "email");
  const [reason, setReason] = useState(target.outreachReason ?? "");
  const [savedReason, setSavedReason] = useState(target.outreachReason ?? "");
  // null = follow the template; a string = the operator hand-edited the message.
  const [override, setOverride] = useState<string | null>(null);
  const [subjectOverride, setSubjectOverride] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);
  // The reason field only turns red after a copy was attempted without it —
  // a form that opens already shouting is one nobody reads.
  const [attempted, setAttempted] = useState(false);
  const reasonRef = useRef<HTMLInputElement>(null);

  const template = selectMessageTemplate(templates, channel, kind);
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
  const subject = channel === "email" ? subjectOverride ?? (template?.subject ? renderTemplate(template.subject, vars) : "") : null;
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
    const problem = validateMessageDraft(subject, message);
    if (problem) {
      setAttempted(true);
      if (missing.includes("reason")) reasonRef.current?.focus();
      toast(problem, { tone: "bad" });
      return;
    }
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      toast("Copy failed. Select and copy the message manually, then open the conversation.", { tone: "bad" });
      return;
    }
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
    const problem = validateMessageDraft(subject, message);
    if (problem) {
      setAttempted(true);
      toast(problem, { tone: "bad" });
      return;
    }
    const r = await run(
      () =>
        api("/api/outreach", {
          partnershipId: target.partnershipId,
          direction: "outbound",
          channel,
          kind,
          body: message,
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
          <Field label="Channel">
          <Segmented<Channel>
            aria-label="Channel"
            value={channel}
            onChange={(c) => {
              setChannel(c);
              setOverride(null);
              setSubjectOverride(null);
              setOpened(false);
            }}
            options={[
              { value: "ig_dm", label: (<><MessageCircle size={12} /> Instagram DM</>) },
              { value: "email", label: (<><Mail size={12} /> Email</>), title: target.businessEmail ?? undefined },
            ]}
          />
          </Field>
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

      <p className="text-xs text-text-muted">{kind === "follow_up" ? "Follow-up draft — check the previous conversation and tailor this continuation." : "First-message draft — personalize it before sending."} The app opens your messaging app; it does not send the message.</p>
      {!template && <Callout tone="info">No default {channel === "email" ? "email" : "DM"} template is configured. Write your message below or <a href="/settings#templates" className="font-medium underline">add a template in Settings</a>.</Callout>}
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
          {channel === "email" && (
            <Field label="Subject" hint={templates.ccEmail ? `Cc ${templates.ccEmail} is included. Only replies received by that mailbox can sync.` : "No sync mailbox is connected."}>
              <Input compact value={subject ?? ""} onChange={(e) => { setSubjectOverride(e.target.value); setOpened(false); }} placeholder="Subject" />
            </Field>
          )}
          <Field
            label="Message"
            hint={
              override !== null && template ? (
                <Button size="sm" variant="link" onClick={() => { setOverride(null); setOpened(false); }}>
                  Reset to the template
                </Button>
              ) : (
                "Edit freely — this exact text is what gets logged."
              )
            }
          >
            <Textarea
              value={message}
              onChange={(e) => { setOverride(e.target.value); setOpened(false); }}
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

      <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={opened ? "secondary" : "primary"}
            onClick={copyAndOpen}
            disabled={!message.trim()}
            icon={copied ? <Check size={14} /> : <Copy size={14} />}
            title="Copies the message and opens the app"
          >
            {copied ? "Copied" : openLabel}
          </Button>
        <Button
          variant={opened ? "primary" : "secondary"}
          onClick={markSent}
          pending={pending}
          disabled={!message.trim()}
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
