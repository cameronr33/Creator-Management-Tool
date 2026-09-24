---
name: verify-creator-tool
description: Verify the Creator Manager app end-to-end before declaring any change done. Use after any edit to the schema, import logic, API routes, or pages — and whenever the user asks to confirm the tool works. Runs typecheck, lint, the isolated preview suite and build, the schema check, the read-only production invariants and a live route smoke-test, and only reports success when every gate is green.
---

# Verifying Creator Manager changes

Never report a change to Creator Manager as complete on the strength of a successful edit alone. Verify it the way a reviewer would, and do not hand back partially verified work. Each step is quantitative so it can self-check.

This is the **graph of loops** described in `AGENTS.md`, run in order: fast
(1) → feature (3) → audit (4) → live (5). Independent review (a
fresh-context agent or `/code-review`) is the watcher loop and runs at
milestones, not inside this skill.

Run from the repo root: `C:\Users\camer\Downloads\CLAUDE CODE\creator-manager`.

## 1. Static gates

```bash
npx tsc --noEmit          # 0 errors
npm run lint              # 0 errors, 0 warnings
```

## 2. Schema is in sync

```bash
npx drizzle-kit generate   # writes a migration only when schema.ts changed
npm run db:apply           # applies it to the database in .env.local
```

**Do not use `drizzle-kit push`** — its interactive enum-rename resolver
requires a TTY and stalls in a non-interactive shell. `db:apply`
(`scripts/apply-schema.ts`) executes the generated SQL statement-by-statement,
skips the `CREATE TABLE` for the shared `users` / `sa_clients` tables, and treats
Postgres duplicate-object codes as "already there", so it is safely re-runnable.

Each migration file runs once (`cm_schema_migrations` records it), so expect
"0 migration file(s) run" when nothing changed. Before applying a fresh
migration, read it: nothing may touch `users` or `sa_*` (an `ON DELETE cascade`
inside a foreign key is fine). A `DROP` or `TRUNCATE` needs the owner's say-so
and a backup first (`npm run db:backup -- <cm_tables>`, into the git-ignored
`backups/`); write drops as `IF EXISTS`. Production is the shared Neon
database — say what a migration does before applying it.

## 3. The feature loop — isolated preview (no production data, network mocked)

```bash
npm run preview:db        # background: synthetic PostgreSQL on 127.0.0.1:5544
npm run preview:verify    # every scripts/verify-*.ts in the suite, in order
npm run preview:build     # production build into .local-preview/build
```

The preview database applies migrations only at start-up: after adding a
migration, stop it (the node process listening on 5544) and start it again.
One script: `node scripts/preview/run.mjs verify scripts/verify-<name>.ts`.

The suite stops at the first non-zero exit, so **check the last script it
printed is `verify-invariants`** — otherwise later scripts never ran. The
preload defers `process.exit` briefly because Node 24 on Windows can crash
at exit after a script passed (libuv assertion, exit 127).

What the scripts anchor:

- **auto-stage** — the full rule matrix (every trigger × every stage), the
  shipment and Posted guards, and Shipped marking the shipment shipped.
- **email-status** — the full `EMAIL_STAGE_RULES` matrix and every guard:
  only the creator's own non-note message counts, verbatim quote, newer than
  the last manual change, prompt injection moves nothing, Undo only for moves
  from email, mail stored mid-read stays unread.
- **email-ingest / gmail-sync / gmail-sync-partial / gmail-health / email-body**
  — who wrote each message, invites and auto-replies as notes, drafts and
  Spam never stored, coverage only advancing on a complete check (and a short
  resync never claiming a new address's 180 days), paging to the end, the lease.
- **today** — the latest-message line and every Today placement.
- **photos** — Instagram hosts only, image type from the bytes (never SVG),
  size cap, the refresh → store → cascade round trip, name-only creators skipped.
- **csv-import** — header aliases, one spelling per campaign, preview writes
  nothing, campaigns created once, re-import is a no-op, nothing overwritten,
  hand-checked views never replaced by estimates.
- **bulk** — removing from a campaign (orphans deleted, others kept), moving
  between campaigns (conflicts skipped), deleting a campaign.
- **add-creator / editors / next-step / creator-workspace / design** — link
  parsing, address parsing, the "Next:" line for every stage, section anchors,
  and the design tokens/primitives rule (frozen node 7).

If you change a rule table, change its expected matrix in the same commit —
never weaken a check to make it pass (frozen node 6).

## 4. Frozen invariants (audit loop — read-only, against the live data)

```bash
npm run verify:invariants
```

Asserts the rules no loop may tune: stage never contradicts its tables
(Ready to ship or later ⇒ shipment; Posted ⇒ video), no retired stage, every
creator in at least one campaign, estimates never labeled authoritative, one
active Gmail account, no duplicated synced messages, and **zero `__verify_`
rows left behind**. The only known failure is "one shipment per partnership"
(Loren Haleston's duplicate records, owner's call:
`npm run fix:duplicate-shipments`). Any other failure means the data or the
code path that wrote it is wrong, not the check.

Anchor for the email loop: `npm run gmail:diagnose` shows whether roster
addresses appear in the mailbox at all.

## 5. Live route smoke-test

With the dev server on port 3002, unauthenticated requests to app routes must
307 to `/login` (proof the auth guard works); signed in, each returns 200:

```
/  /pipeline  /creators  /creators/new  /import  /settings  /help  /login
```

Signing in is the owner's job — never enter a password. Once they have, open
the changed pages in the Browser pane: zero new console errors, and every
mutation produces a toast (a save that refreshes silently is a regression).
For an interaction you changed (stage menu, Mark shipped, Import, delete),
perform it and confirm it persists across a refresh.

The scheduled email check:

```bash
curl -s -X POST localhost:3002/api/cron/email-sync -H "Authorization: Bearer $CRON_SECRET"
```

With no mailbox connected it must return `ok` with a skip reason, not an error.

## On failure

Fix the issue and rerun from step 1. When a failure reveals a gap the checks
didn't catch, add a negative test for it first — improve the system, not just
the instance.
