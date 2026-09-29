# Creator Manager

Multi-client creator relationship management for the agency. Every creator across
every client has one record — photo, conversation, agreement, shipping and
posted videos — and moves through one A-to-Z pipeline per campaign. Email with
the creators you've entered is read automatically and keeps their stage current.

Sibling to `social-analytics-dashboard`; shares its Neon instance (`cm_*` tables)
and `users` login. Next.js 16 · React 19 · Drizzle · NextAuth v5 · Tailwind 4.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill in real values — see the comments in that file
npm run db:apply                   # create cm_* tables in Neon (NOT db:push — see Gotchas)
npm run db:seed                    # create/promote the admin user
npm run dev                        # http://localhost:3002
```

## New teammate setup

For a self-contained UI and verification environment with fictional records,
see [Isolated local preview](docs/isolated-preview.md). It needs no production
credentials or Neon branch.

This repo shares a Neon Postgres instance with `social-analytics-dashboard` —
the same database that holds live HELLA creator data (names, addresses) and the
analytics dashboard's data. **Don't develop against production.** Ask the
project owner for:

1. **Repo access** — a GitHub collaborator invite.
2. **A Neon branch connection string** — the owner creates one from the Neon
   console (Branches → Create branch), which gives you a full copy-on-write
   clone of the schema and data, isolated from production. Use this as your
   `DATABASE_URL`, not the production string.
3. **A login on your branch** — run `npm run db:seed` with your own
   `ADMIN_EMAIL`/`ADMIN_PASSWORD` in `.env.local` (safe — it's your branch, not
   production's `users` table).

These are shared out of band (a password manager, not git or chat). Then:

```bash
git clone <repo-url>
cd creator-manager
npm install
cp .env.local.example .env.local
# Fill in: your branch DATABASE_URL, freshly-generated NEXTAUTH_SECRET /
# TOKEN_ENCRYPTION_KEY / CRON_SECRET (commands are in the example file's
# comments — no need to match anyone else's), and your own ADMIN_EMAIL/PASSWORD.
npm run db:apply
npm run db:seed
npm run dev   # http://localhost:3002 — log in with the admin login you just created
```

## Model

A **creator** is a person (name, profile links, photo, email addresses, numbers),
reusable across campaigns. A **partnership** is one creator × one campaign — the
pipeline row. Its `stage` answers exactly one question — *what is this deal
waiting on right now* — while shipping lives in `cm_shipments`, posts in
`cm_deliverables`, and contract status in `agreementType`.

Stages (`src/lib/stages.ts`, labels in quotes): `shortlisted` "To contact" →
`contacted` → `in_conversation` "Talking" → `awaiting_address` "Agreed" →
`finalizing` "Finalizing" (contract or open questions) → `fulfilling` "Ready to ship" → `shipped` → `content_pending` "Waiting on
video" → `posted`, plus closed `passed` / `declined` / `no_response` (split
by who ended it). The enum still holds four retired values (`researched`,
`negotiating`, `agreed`, `completed`); nothing writes them and
`verify:invariants` asserts none remain.

Every page is scoped by the sidebar's **client** and **campaign**. Creators
arrive by **Import CSV** (a Name column and a Campaign column; campaigns are
matched ignoring case and created when missing — `src/lib/csv-import.ts`) or
**Add creator**; their Instagram photo and followers are fetched afterwards
(`src/lib/instagram.ts`, stored in `cm_creator_photos`).

## The deal: contracts and email fill it in

The Deal card on a creator takes a **contract PDF** (Upload contract, ≤ 10 MB),
and PDFs attached to the creator's email thread — by them, us or the brand,
never a stranger cc'd in — are recorded when the mail is stored and downloaded
by the next email check (`cm_contracts`, `src/lib/contracts.ts`). Each file is
read once by Claude into deal facts: signed or not, products, fee, terms, the
creator's shipping address. The email reader reads the same facts from the
conversation, each checked against the messages (a product only in the
creator's own words; a fee only with its amount in a verbatim quote, once the
deal is Agreed).

One rule writes them (`src/lib/deal-facts.ts`, owner decision 2026-09-24):
**blank fields fill, nothing filled is replaced.** The only upgrade is verbal →
signed. Products are added only when none are listed; an address only when
none is on file and it parses completely — which then moves an Agreed
creator to Ready to ship through the rule table. Where the latest signed
contract (or the email) disagrees with what's recorded, the Deal card offers
it — **Use it** or **Keep mine** (remembered in `deal_dismissed`). Every fill
leaves a timeline note naming its source. Contracts never reach the client
portal.

`npm run contracts:backfill` (dry run first) records PDFs on email stored
before this existed. Migration 0018 marks every conversation with email
unread once, so the deploy that ships this re-reads them all and fills blank
deals (`npm run email:assess -- --apply` does the same by hand).

When the model service is down — no API credit, rate limits, overload —
nothing is skipped for good: conversations stay unread and contracts keep
their attempts, and both are read once it's back (`serviceUnavailable` in
`src/lib/claude.ts`).

## Clients in the tool

People at a client (e.g. HELLA staff) live in `cm_client_users` — this app's
own table, never the shared `users` (which other tools and the email team list
read). Settings → *<client>'s team*:

- **Everyone listed is a client contact for email.** Their messages on their
  own brand's creator threads are stored as the client's notes. They never
  count as the creator replying or as us, and they never become the "latest
  message".
- **Invite to log in** creates a one-time link (sha256 stored, 7 days). You
  send it yourself; the person chooses their own password. They sign in on
  the same login page and only ever see `/portal`, for their own brand.
- **"<client> approves each creator before anyone reaches out"** makes new
  creators wait. The client approves or passes in the portal, or the agency
  does it for them. Approval is an attribute of the partnership, never a stage
  move; passing closes the partnership as We passed · Client passed.

**The portal:**

- **Pages:** Overview, Approve creators, Ship product (the confirmed address
  while it's theirs to send), and All creators.
- **Shipping:** a client marking something shipped moves the stage through the
  same rule as ours, and who did it is recorded.
- **Data:** `src/lib/portal-data.ts` picks every column by name. There are no
  email bodies or summaries, fees, terms or notes, and nothing from another
  client.

**Access:**

- Every agency route calls `requireAgency()`, and every portal route calls
  `requireClientUser()`.
- `scripts/verify-access.ts` fails the build graph if a handler has no guard.


- **Email check** (`src/lib/gmail-sync.ts`) — reads the Gmail mailbox connected
  in Settings (read-only) and searches it **only** for the addresses saved on
  creators; nothing else is read or stored. A new address gets a 180-day
  search; after that only mail since the last complete check. Runs on page
  visits (at most every 15 minutes, signed-in only), when an address is added,
  on **Check now**, and on the Railway cron (`/api/cron/email-sync`). Drafts
  and Spam are never stored; invites and auto-replies are kept as notes.
- **Email reading** (`src/lib/email-status.ts`) — after new mail, the
  conversation is read (Claude, `EMAIL_STATUS_MODEL`) for a one-line summary,
  whose turn it is, and an address the creator wrote. With `EMAIL_AUTOMOVE=on`
  it may also move the stage — see Automatic moves.
- **Heartbeats** — every check writes a `cm_job_runs` row (`ok` / `idle` /
  `error`) and Today shows when email was last checked, so a dead loop is
  visible instead of silent.
- **Per-client settings** (Settings → Clients) — which clients this tool shows
  and each client's follow-up timing, which Today's Follow up list uses.

### Email sync setup (one-time, Google Cloud)

1. [console.cloud.google.com](https://console.cloud.google.com) → create (or
   pick) a project → **APIs & Services → Library** → enable **Gmail API**.
2. **APIs & Services → OAuth consent screen** — if the mailbox is on Google
   Workspace, set User type **Internal** (no Google verification needed).
   Personal-Gmail accounts must use External + Testing mode and add the
   mailbox as a test user — note Google expires Testing-mode refresh tokens
   after 7 days, so a Workspace/Internal app is strongly preferred for the
   cron.
3. **Credentials → Create credentials → OAuth client ID** → Web application.
   Authorized redirect URI: `{APP_URL}/api/gmail/callback` (add one entry per
   environment, e.g. `http://localhost:3002/api/gmail/callback` and the
   Railway URL).
4. Put the client ID/secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
   (locally in `.env.local`; on Railway on the **web** service).
5. In the app: Settings → Email sync → **Connect Gmail**, sign in as the
   cc'd mailbox, approve the read-only scope.

The refresh token is stored AES-256-GCM-encrypted using
`TOKEN_ENCRYPTION_KEY` — that variable is now load-bearing; changing it means
reconnecting Gmail.

## Automatic moves

Two engines may move a stage, both forward only, neither ever closing a deal
(AGENTS.md frozen node 2):

- **The rule table** (`src/lib/auto-stage.ts`): first message → Contacted, a
  reply → Talking, a complete address → Ready to ship, an unsigned contract →
  Finalizing, Finalizing → Ready to ship once the deal is signed and the
  address is in, marked shipped → Shipped, delivered → Waiting on video, a
  video link → Posted.
- **Email reading** (`EMAIL_STAGE_RULES` in `src/lib/email-status.ts`): only
  from the creator's own message, quoted word for word, newer than the last
  manual change, not low confidence — Ready to ship also needs an address,
  Posted the creator's own post link. Every such move shows its quote with Undo.

A "no" is only flagged (Today and the creator page offer to close it). Every
move lands in `cm_stage_transitions` with its source and reason, and each
creator's page shows it as **Stage history** (`src/lib/history.ts`: who or
what moved it, the email quote, anything undone).

## Working the list (product update, 2026-09-28)

- **Owners.** `cm_partnerships.owner_id` (FK to the shared `users`, set null;
  `users` itself is never altered). New deals start unassigned; take one on
  Today, assign from the creator page, or in bulk on Creators. **Mine** shows
  yours plus unassigned (the `cm_view` cookie remembers it; a first visit is
  Everyone), and every count on a Mine view says what it hides ("7 of
  Kieran's not shown"). Changing the owner never bumps `updatedAt`.
- **Today** (`src/lib/today.ts`) sorts each section by how long it has
  waited, oldest first; imported rows with unknown dates get no clock and go
  last. Timing is per client (`src/lib/thresholds.ts` is the one table for
  defaults, Settings and Help): first message due, two follow-ups, No
  response, a nudge for a deal gone quiet at Talking / Agreed / Finalizing,
  and a video late after delivery.
- **Archive** (`src/lib/archive-rules.ts`, 2026-09-29 — it replaced Snooze)
  puts a creator out of Today, the Pipeline and the Creators list, with an
  optional reminder date and a reason; it is checked on page load — they come
  back if they write (an inbound message stored after it) or their stage
  changes, and any stage move clears it. Creators → Archived lists them with
  Restore; bulk Archive / Restore on Creators. (The columns kept their
  `snooze_*` names.)
- **Logging by hand** (`src/lib/logging.ts`): I messaged them / They replied
  stay one click; the calendar button beside them logs an earlier day or an
  email from your own inbox or a call. Email logged by hand is never read,
  queued or re-labelled by the email reader (synced = `channel email` with an
  `external_id`).
- **Stage looks out of date** (`src/lib/stage-flag.ts`): the email reader
  also reads where the deal stands from the messages alone. When that's an
  earlier stage than the one set (a creator imported as Agreed whose emails
  say talks are paused), Today lists them first and the creator page asks —
  Move to Talking, or Keep Agreed — and the Next line follows the emails.
  Nothing moves backward by itself.
- **Undo** (`src/lib/quick-actions.ts`, table `cm_quick_actions`): each quick
  press records what it did; its toast offers Undo for ten seconds, and the
  server allows it only for whoever pressed it, within ten minutes, once,
  while nothing has changed since.
- **The portal** shows each video's views labelled verified or estimated and
  never adds the two; Ship product can download the list as CSV
  (`src/lib/portal-export.ts`: Ready to ship only, spreadsheet-formula safe)
  or print it, and asks once before marking shipped without tracking.

## Verifying changes

Run the `verify-creator-tool` skill, or manually:

```bash
npx tsc --noEmit && npm run lint
npm run preview:db &               # isolated synthetic database on 127.0.0.1:5544
npm run preview:verify             # every verify script, network mocked (restart preview:db after a new migration)
npm run preview:build              # production build, isolated
npm run verify:invariants          # FROZEN rules, read-only against live data — the audit loop (see AGENTS.md)
npm run gmail:diagnose             # anchor: do roster addresses appear in the mailbox at all?
```

One-off data commands take `--dry-run` first: `email:assess`,
`photos:backfill`, `stages:migrate`, `gmail:resync`, `contracts:backfill`
(dry by default; `--apply`).

## Design system

The UI is the Sentic brand kit applied to a dense internal tool: Inter, a
navy sidebar, one blue action colour, lime for "alive" signals. Everything is
built from two files:

- `src/app/globals.css` — the tokens. Surfaces, text (`--text`,
  `--text-muted`, `--text-faint` — all ≥ 4.5:1 on white), the action colour
  (`--accent`, `-hover`, `-soft`, `-ring`), four semantic tones
  (`info`/`good`/`warn`/`bad`, each with `-soft` background and `-line`
  hairline), the sidebar palette and the raw brand colours. Add a colour here
  or don't add it.
- `src/components/ui.tsx` — the primitives: `PageHeader` (title, client badge,
  one-line purpose, `?` link to Help), `Card`/`CardHeader`, `Button`
  (`primary` = the one thing to do here, `secondary`, `ghost`, `danger`,
  `link`), `IconButton` (label required), `Input`/`Select`/`Textarea`,
  `Field` (label + hint + error), `Callout`, `Badge`, `StagePill` (tooltip =
  the stage's hint), `Segmented`, `EmptyState`, `StatTile`.

Two conventions make the tool teachable:

- **Every mutation goes through `useSave()`** (`src/components/use-save.ts`),
  which toasts success/error and announces automatic stage moves. Nothing
  saves silently. Destructive actions use `ConfirmButton` (two-step, inline).
- **The app explains itself from its own tables.** Stage labels, hints,
  groups and exit reasons live in `src/lib/stages.ts`; the auto-stage rules
  in `src/lib/auto-stage.ts`; `/help` and the record page's "Next:" line
  (`src/lib/next-step.ts`) are generated from them, so the explanation cannot
  drift from the behaviour. `npm run verify:design` and
  `npm run verify:next-step` keep both honest.

The build process itself is a graph of loops (fast → feature → watcher →
audit → reference) with frozen nodes and anchors — `AGENTS.md` is the
authoritative description and every agent reads it first.

## Gotchas

- **Dates rendered on the server use the server's time zone.** The app runs
  on a teammate's machine today, so server and browser agree. If it's ever
  hosted elsewhere (a cloud server runs in UTC), set `TZ` to the team's zone
  (for example `TZ=America/Los_Angeles`), or "Sep 28, 6 pm" shows as Sep 29.
  Dates picked in the browser (an archive reminder, a logged day) are sent as instants and
  shown back in the browser's own zone.

- **Schema changes: use `db:generate` + `db:apply`, never `db:push`.**
  `drizzle-kit push`'s interactive enum-rename resolver needs a TTY and hangs
  in a non-interactive shell. `db:apply` (`scripts/apply-schema.ts`) runs the
  generated SQL statement-by-statement, skips the shared `users`/`sa_clients`
  table creates, and is safely re-runnable.
- **Never develop against production `DATABASE_URL`.** Use a Neon branch — see
  "New teammate setup" above.
