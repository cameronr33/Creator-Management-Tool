---
name: verify-creator-tool
description: Verify the Creator Manager app end-to-end before declaring any change done. Use after any edit to the schema, import logic, API routes, or pages — and whenever the user asks to confirm the tool works. Runs typecheck, lint, build, schema-diff, the offline import assertions, and a live route smoke-test, and only reports success when every gate is green.
---

# Verifying Creator Manager changes

Never report a change to Creator Manager as complete on the strength of a successful edit alone. Verify it the way a reviewer would, and do not hand back partially verified work. Each step is quantitative so it can self-check.

Run from the repo root: `C:\Users\camer\Downloads\CLAUDE CODE\creator-manager`.

## 1. Static gates

```bash
npx tsc --noEmit          # 0 errors
npm run lint              # 0 errors
npm run build             # succeeds
```

If `next build` fails on a stale route type referencing a deleted page, `rm -rf .next` and rerun — a removed `page.tsx` leaves a dangling entry in `.next/types`.

A stale `.next` can also silently drop routes from the **dev** server's route
table — the symptom is a 404 on a route whose file plainly exists (seen once
with `/api/auth/[...nextauth]`, which broke login with a NextAuth 404/
ClientFetchError). Diagnose by curling the route (404) vs a sibling API route
(alive); fix by stopping the dev server, `rm -rf .next`, and restarting.

## 2. Schema is in sync

```bash
npm run db:generate && npm run db:apply
```

**Do not use `drizzle-kit push` here** — its interactive enum-rename resolver
requires a TTY and stalls in a non-interactive shell. `db:apply`
(`scripts/apply-schema.ts`) executes the generated SQL statement-by-statement,
skips the `CREATE TABLE` for the shared `users` / `sa_clients` tables, and treats
Postgres duplicate-object codes as "already there", so it is safely re-runnable.

Expect the summary line to report 0 new statements when nothing changed. Before
applying a fresh migration, read it and confirm there are no `DROP`/`TRUNCATE`
statements and nothing touches `users` or `sa_*` (an `ON DELETE cascade` inside a
foreign key is fine — that's a clause, not a statement).

## 3. Import fidelity (offline, no DB)

```bash
npx tsx scripts/verify-import.ts
```

This asserts the migration against the real HELLA CSVs. **All checks must print PASS**, in particular:

- 32 tracker creators, 11 shipping records, 0 unmapped stage values
- Joe Hubbard → `fulfilling` + signed + ready shipment; Michael Dey → `awaiting_address` + in the conflict report; Trail Boss Dad → `passed` with null exit reason + flagged; 802 Garage → `negotiating` + flat_fee; Nico → `fulfilling` + two products
- ≥6 verbal agreements sit in `awaiting_address`
- Every stage ≥ `fulfilling` carries a shipment (the stage-integrity invariant)

If you changed the stage-derivation rules, update the assertions in `scripts/verify-import.ts` to match the new intent — do not weaken a check just to make it pass.

## 3b. Add-creator feature (parser + live DB, self-cleaning)

```bash
npm run verify:add-creator
```

Asserts the multi-platform link parser (Instagram / TikTok / YouTube / Facebook /
X / bare website / `@handle` / query-string stripping), username derivation and
its name-slug fallback, and — against the real database, cleaning up after
itself — that `createCreatorWithPartnership` stores every link with exactly one
primary, mirrors the primary onto `cmCreators.profileUrl`/`platform`, writes the
opening stage transition, and **reuses** rather than duplicates a creator or
partnership when the same handle is added twice.

If creators exist without any link row (e.g. imported before
`cm_creator_socials` existed), run `npm run backfill:socials` — it derives a
primary link from `profileUrl` and is idempotent.

## 3c. Full Analysis / two-pass research (pure math + live DB, self-cleaning)

```bash
npm run verify:quick-analysis
```

Asserts `aggregateReels` (the pure port of `aggregate_metrics.py`'s Step 2
math) against known fixtures — avg/median/max, date range, cadence, top-3
ordering capped at 3, and the 0-reel/1-reel edge cases — then, against the
real database with full cleanup, the `cm_research_requests` lifecycle: a
request appears in `listQueuedRequests()` while `status: "queued"`, drops out
once claimed to `"running"`, and `getLatestRequestForPartnership` tracks
`quickPassAt` and `status` correctly through to `"completed"`.

This does **not** call Apify or the Claude API — it verifies the plumbing
around those calls, not the calls themselves. To check the live integration,
mint a temporary API key and exercise `.claude/skills/creator-research/scripts/queue_client.py --list / --claim / --complete / --fail` against the running
dev server, then revoke the key and delete the test rows — the same pattern
used to validate this feature originally, no test data or keys left behind.

## 3d. Streamlining features (auto-stage, send flow, editors, email ingest)

```bash
npm run verify:auto-stage
npm run verify:outreach-flow
npm run verify:editors
npm run verify:email-ingest
npm run verify:gmail-sync
```

All five are self-cleaning (throwaway `__verify_` rows, cascade-deleted).

- **auto-stage** asserts the FULL pure rule matrix (every trigger × every
  stage) plus a live lifecycle with `cm_stage_transitions` audit rows. If you
  change the rule table in `src/lib/auto-stage.ts`, change the expected table
  in the script deliberately — never weaken a check to make it pass.
- **outreach-flow** asserts renderTemplate/URL builders and that a logged
  event stores the actual channel/body/subject (the old worklist hardcoded
  `ig_dm` and logged the template).
- **editors** asserts `parseAddress` on the four documented HELLA shapes, the
  metricsSource labeling rules (manual public views → `ig_public_chrome`,
  Apify → `apify`, provisional), and the shipment create-with-typed-carrier
  path.
- **email-ingest** asserts the Gmail matcher (direction by From vs To/Cc,
  case-insensitive, display-name forms) and the live idempotent ingest
  (double-push → exactly one row; replies advance `contacted →
  in_conversation`).
- **gmail-sync** asserts the pure Gmail helpers (query batching, MIME
  text/plain extraction, message normalization) and the cm_gmail_accounts
  round-trip with a real encrypt/decrypt cycle. It does NOT hit Google —
  the OAuth flow itself is verified by clicking Connect Gmail + Sync now in
  Settings with `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` set. The cron
  route without a connected account must return
  `{ok: true, skipped: "no Gmail account connected"}`, not an error.

## 4. Live route smoke-test

Start the dev server (`npm run dev`, port 3002) and confirm every route responds. With a valid session cookie each should return 200; unauthenticated, the app routes must 307 to `/login` (that redirect is itself proof the auth guard works):

```
/  /creators  /pipeline  /outreach  /campaigns  /import  /settings  /login
```

Then open the changed pages in the browser (Browser MCP), and assert **zero new console errors**. For an interaction you changed (stage drag, log touchpoint, shipment status, add deliverable), perform it and confirm the row updates and persists across a refresh.

## 5. Loop endpoints

If you touched the alert or refresh logic, exercise the cron routes directly with the `CRON_SECRET` bearer and assert the JSON result shape:

```bash
curl -s -X POST localhost:3002/api/cron/follow-ups -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{}'
```

Seed a partnership with an outbound event 6 days old and confirm exactly one `follow_up_1_due` alert appears; confirm a replied partnership produces none.

## On failure

Fix the issue and rerun from step 1. When a failure reveals a gap the checks didn't catch, add an assertion for it — improve the system, not just the instance.
