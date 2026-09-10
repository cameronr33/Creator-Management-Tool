---
name: email-sync
description: Sync creator outreach email threads from the connected Gmail into Creator Manager. Use when the user asks to sync email, check for creator replies, update outreach from email, or run the email tracking loop. Reads mail via the Gmail MCP connector, matches threads to creators by business email, and pushes touchpoints to the app's /api/emails/ingest endpoint — which auto-logs them on each creator's timeline and advances pipeline stages.
---

# Email sync — track creator outreach happening over email

> **The app now does this itself.** Settings → Email sync connects a Gmail
> mailbox via OAuth (read-only) and the cron worker syncs twice a day
> (`/api/cron/email-sync`), with a Sync now button for on-demand runs. Use
> this skill only as a manual fallback — e.g. the Google OAuth app isn't set
> up yet, or you want to sync a mailbox that isn't the connected one. Both
> paths feed the same `/api/emails/ingest` endpoint and dedupe on the Gmail
> message id, so mixing them is safe.

Creator outreach email is sent by a teammate from their own mailbox with
**the sync mailbox cc'd** (whichever account is connected under Settings →
Email sync). This skill reads those threads from the Gmail connector and
pushes them into Creator Manager so the outreach timeline, follow-up queue,
and pipeline stages stay current without anyone hand-logging touchpoints.

**Tracking only.** This skill never drafts, sends, or replies to any email.

**Coverage caveat (tell the user when relevant):** only threads where the
sync mailbox is on To/Cc are visible. If a creator replies without
reply-all, that reply cannot be synced — the teammate should keep the cc on
every message (the app pre-fills it in `mailto:` links).

## Prerequisites

- `CM_API_URL` (e.g. `http://localhost:3002`) and `CM_API_KEY` (Settings →
  API keys) in the environment, same as the creator-research skill.
- The Gmail MCP connector for the sync mailbox, available to Claude in this
  session. **The python script cannot read mail** — MCP tools are
  Claude-only; the script exists solely to talk to the app's API.

## The loop

### 1. Fetch the roster

```bash
python .claude/skills/email-sync/scripts/email_client.py --roster
```

Returns creators with a business email and an open (non-terminal)
partnership: `{partnershipId, creatorId, clientSlug, name, username,
businessEmail, stage}`.

### 2. Search Gmail (Claude, via the Gmail MCP tools directly)

Search for threads involving roster addresses. Batch a handful of addresses
per query to stay under query-length limits:

```
(from:a@x.com OR to:a@x.com OR from:b@y.com OR to:b@y.com) newer_than:14d
```

The 14-day window plus server-side dedup makes reruns idempotent — a message
synced twice is skipped, never duplicated. Widen the window on a first run
(`newer_than:90d`) to backfill history.

### 3. Normalize each message

For every message in every matched thread, build one object:

| Field | Source |
|---|---|
| `externalId` | Gmail **message** id (the dedup key) |
| `threadId` | Gmail thread id |
| `occurredAt` | the message date, ISO format |
| `from` | From header (either `addr` or `Name <addr>` form is fine) |
| `to`, `cc` | recipient address lists |
| `subject` | subject line |
| `bodyText` | plain-text body (trim quoted history if easy; raw is acceptable) |

Do NOT decide direction or initial-vs-follow-up — the server owns all
matching logic. Include every message on the thread, even ones that look
irrelevant; unmatched ones are reported back, not inserted.

Write the array to a JSON file in the session scratchpad.

### 4. Push

```bash
python .claude/skills/email-sync/scripts/email_client.py --push <file.json>
```

The server matches on business email (From = creator → inbound reply;
To/Cc = creator → outbound), inserts `channel: "email"` touchpoints, and
auto-advances stages (`shortlisted → contacted` on first outbound,
`contacted → in_conversation` on a reply).

### 5. Report

Summarize for the user: X new touchpoints, which creators replied (these are
the actionable ones), any stage changes, and any `unmatched` addresses —
those may be creators whose `businessEmail` is missing or different in the
app; suggest fixing the profile rather than ignoring them.

## Running it on a schedule

While working: `/loop 30m sync creator outreach email with the email-sync skill`.
Or set up a scheduled task. Each run is a fresh 1→5 pass; idempotency makes
overlap harmless.
