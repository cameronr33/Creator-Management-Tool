# Creator Manager

Multi-client creator relationship management for the agency. Every creator across
every client has one record — research, outreach history, agreement, product,
shipping, and posted content — fed by the `creator-research` skill and surfaced
through scheduled loops.

Sibling to `social-analytics-dashboard`; shares its Neon instance (`cm_*` tables)
and `users` login. Next.js 16 · React 19 · Drizzle · NextAuth v5 · Tailwind 4.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill in real values — see the comments in that file
npm run db:apply                   # create cm_* tables in Neon (NOT db:push — see Gotchas)
npm run db:seed                    # create/promote the admin user
npm run import:hella -- --dry-run  # preview the HELLA migration + conflict report (owner only)
npm run import:hella               # apply it
npm run dev                        # http://localhost:3002
```

## New teammate setup

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

A **creator** is an identity + research snapshot, reusable across campaigns. A
**partnership** is one creator × one campaign — the pipeline row. Its `stage`
answers exactly one question — *what is this deal waiting on right now* — while
shipping lives in `cm_shipments`, posts in `cm_deliverables`, and contract status
in `agreementType`. Nothing is stored in two places, which is what let the two
original spreadsheets drift apart.

Stages: `researched → shortlisted → contacted → in_conversation → negotiating →
agreed → awaiting_address → fulfilling → content_pending → posted → completed`,
plus terminal `passed` / `declined` / `no_response` (split by who ended it).

## Loops

- **Follow-up sweep** (`/api/cron/follow-ups`, daily) — opens alerts for overdue
  outreach and retires creators who go dark after two follow-ups.
- **Tier-1 metric refresh** (`/api/cron/refresh-metrics`, weekly) — refreshes
  followers via Apify REST. Deliberately does **not** touch view counts: accurate
  public Views require the Chrome-grid scrape in the `creator-research` skill
  (Tier 2, run locally), which pushes back via `/api/ingest/research`.

Both are driven by `scripts/cron-worker.ts` on a Railway worker service.

- **Email sync** (`.claude/skills/email-sync`, run by Claude locally) — reads
  creator outreach threads from the connected Gmail (cameron@sentic.io is cc'd
  on outreach sent by a teammate), matches them to creators by business email,
  and pushes touchpoints to `/api/emails/ingest`. Replies auto-advance
  `contacted → in_conversation`. **Tracking only** — it never sends mail.
  Coverage limit: a creator reply that doesn't reply-all to the cc'd mailbox is
  invisible to the sync, so keep the cc on every message.

## Auto-stage

Routes advance the pipeline automatically on unambiguous events
(`src/lib/auto-stage.ts`): first outbound message → `contacted`, a reply →
`in_conversation`, a complete address → `fulfilling`, shipped/delivered →
`fulfilling`/`content_pending`, a posted video → `posted`. Rules are a strict
from-stage allowlist — they never move a stage backward and never touch the
judgment stages (`negotiating`, `agreed`, `completed`) or terminals. Every
change lands in `cm_stage_transitions` like a manual move.

## Verifying changes

Run the `verify-creator-tool` skill, or manually:

```bash
npx tsc --noEmit && npm run lint && npm run build
npm run verify:import          # offline migration-fidelity assertions
npm run verify:add-creator     # link-parser + manual-add assertions (hits the DB, self-cleans)
npm run verify:auto-stage      # auto-stage rule matrix + live lifecycle (self-cleans)
npm run verify:outreach-flow   # send-flow rendering/logging assertions (self-cleans)
npm run verify:editors         # address parser, metric labeling, shipment path (self-cleans)
npm run verify:email-ingest    # Gmail matcher + idempotent ingest (self-cleans)
```

## Gotchas

- **Schema changes: use `db:generate` + `db:apply`, never `db:push`.**
  `drizzle-kit push`'s interactive enum-rename resolver needs a TTY and hangs
  in a non-interactive shell. `db:apply` (`scripts/apply-schema.ts`) runs the
  generated SQL statement-by-statement, skips the shared `users`/`sa_clients`
  table creates, and is safely re-runnable.
- **Never develop against production `DATABASE_URL`.** Use a Neon branch — see
  "New teammate setup" above.
