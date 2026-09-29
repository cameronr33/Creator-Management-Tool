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
printed is `verify-invariants`** (31 scripts after the boundary check, as of
2026-09-28) — otherwise
later scripts never ran. The
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
- **today / today-data** — the latest-message line and every Today
  placement; nudges for quiet deals, Due and Late, the oldest-first sort
  (unknown dates last), "waiting since" ignoring undone moves and undo rows;
  Archive's rules (their message brings them back, ours and invites don't; a
  stage move clears it; archived creators are out of Today, the Pipeline, the
  Creators list and every count).
- **logging** — the date limits (never the future, 180 days back), a message
  dated before a person's stage change never moves it (a late "They replied"
  can't reopen No response; the one-time stage clean-up doesn't count), email
  logged by hand is never queued, read or re-labelled, and nothing a teammate
  typed on a hand log is ever cited to move a stage or fill the deal.
- **undo** — the planner matrix (who, ten minutes, once, never synced mail,
  never after the stage or shipment changed) and the four quick buttons there
  and back, a created shipment, undo B then A, a doubled click; a change
  landing between the checks and the write (a stage move, a bounce away and
  back, a tracking number, a status) leaves nothing written; with two
  shipments only the rows the press touched change (the pressed one, and one
  its move to Shipped marked); the email reader still respects a quick Undo;
  a tracking number saved later keeps the ship date; the portal's presses are
  never undoable.
- **stale stage** (verify-today, verify-today-data, verify-email-status) — the
  staleStage matrix (only Talking / Agreed / Finalizing, never closing, a
  person's later move and Keep win), Today lists it first, Move is a
  compare-and-set person's move and Keep dismisses until newer mail, the
  reader keeps the messages' own stage only with a verified line and never
  moves backward.
- **history** — every move's line (added, a person, a rule and what set it
  off, the email reader, a client's pass, the stage clean-up) and undo folded
  into the move it undid, read back with names.
- **owners** — Mine / Everyone, take never steals, assigning checks the
  teammate exists, the owner survives a campaign move, Today's hidden counts
  (only what Today would list), and the Creators list's search and empty
  states on Mine.
- **photos** — Instagram hosts only, image type from the bytes (never SVG),
  size cap, the refresh → store → cascade round trip, name-only creators skipped.
- **csv-import** — header aliases, one spelling per campaign, preview writes
  nothing, campaigns created once, re-import is a no-op, nothing overwritten,
  hand-checked views never replaced by estimates.
- **bulk** — removing from a campaign (orphans deleted, others kept), moving
  between campaigns (conflicts skipped), deleting a campaign.
- **access** — every API handler calls a guard (agency, portal, cron, or the
  invite token for `/api/invite` only), portal routes never read the agency's
  client cookie, every agency server action refuses a client login, and only
  the three cookie modules anywhere in `src` read a cookie.
- **client-users / approvals / portal** — invites work once and expire, only
  the hash is stored; approvals only for the right brand and only what's
  waiting; the portal returns exactly the agreed fields and never a planted
  private value; a client's shipment moves the stage through the same rule;
  views go out labelled (only Instagram's public count is verified) and the
  totals never mix; the shipping list holds Ready-to-ship rows only, with a
  formula guard.
- **deal-fill / contracts** — a contract or an email fills only blank deal
  fields (a hand edit landing mid-fill wins), verbal → signed is the only
  upgrade, differences are offered never applied, only an Agreed deal moves
  to Ready to ship on a filled address; uploads are PDFs by their bytes and
  ≤ 10 MB, stored once, read once even when two reads race, not-a-contract
  fills nothing, email attachments are fetched by their stable part id.
  email-status also asserts a product counts only in the creator's own words
  and a fee only with its amount in a verbatim quote from them or us.
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
active Gmail account, no duplicated synced messages, no quick action pointing
at synced mail, and **zero `__verify_` rows or throwaway logins left
behind**. The only known failure is "one shipment per partnership"
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
/portal  /portal/approve  /portal/ship  /portal/creators
```

A client login must land on `/portal` and get 403/redirect from every agency
page and `/api/*` route; a teammate opening `/portal` sees it read-only.

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
