# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# How this app is built: a graph of loops, not one loop

A single "edit → checks pass → done" loop fails in four known ways: it games its
own metric, it can't question its target, independent loops fight, and its
measurements decay unnoticed. So the build process here is a **graph of loops
with anchors** — read this before changing anything.

## The loops, fastest to slowest

| Loop | Runs | What it controls | Anchor (the thing that can't be argued with) |
|---|---|---|---|
| **Fast** | every edit | `npx tsc --noEmit`, `npm run lint` | the compiler |
| **Feature** | every feature | a self-cleaning `scripts/verify-<feature>.ts` (pure assertions + live-DB lifecycle with throwaway `__verify_` rows, cleaned in `finally`) | real rows written and read back from the real database |
| **Watcher** | every milestone | an **independent, fresh-context reviewer** (review agents, `/code-review`) — never the author grading their own work | findings that name file:line and a failure scenario |
| **Audit** | before every commit | `npm run verify:invariants` — read-only frozen rules run against the live data | production data itself |
| **Reference** | when a human decides | thresholds, rule tables, what "better" means | a person, with a stated reason in the commit |

`npm run build` is the gate between the fast and feature loops. The
`verify-creator-tool` skill runs the whole graph in order.

## Frozen nodes — rules the optimizer never tunes

These exist precisely because a loop under pressure would be tempted to weaken
them. Changing one requires a human decision and an explanation in the commit.

1. **Estimates never masquerade as accurate.** `viewsSource`/`metricsSource`
   `apify` is provisional; `ig_public_chrome` is authoritative. Nothing
   automated may overwrite an `ig_public_chrome` value with an `apify` one
   (see `quick-analysis.ts`, `ingest.ts`, `refresh.ts`).
2. **Auto-stage never moves an active stage backward** and never sets a
   judgment stage (`negotiating`, `agreed`, `awaiting_address`, `completed`)
   or `passed`/`declined`. The one reopen is `no_response → in_conversation`
   on the creator's own reply. The full rule matrix is asserted in
   `verify-auto-stage.ts`; edit both or neither.
3. **Verification leaves nothing behind.** Every live check cleans up in
   `finally`; `verify:invariants` asserts zero `__verify_` rows remain.
4. **Shared tables (`users`, `sa_clients`) are never altered by this app's
   migrations.** `db:apply` skips their `CREATE TABLE`; per-app knobs live in
   `cm_client_settings`, never on the shared row.
5. **Secrets never enter git.** `.env*` is ignored; every commit is content-
   scanned for secret-shaped strings before staging.
6. **A check is never weakened to make it pass.** If a check fails, the code
   or the data is wrong. If a check was wrong, say why in the commit.

## Green must mean grounded

A loop reporting "ok" while doing nothing is the most expensive failure mode
here — it looks like health. So:

- Every background job writes a `cm_job_runs` heartbeat with a status of
  `ok` (did work), `idle` (nothing to do — still healthy), or `error`. Settings
  → Automation health flags any loop that hasn't completed within 1.5× its
  interval. "Hasn't run" and "ran with nothing to do" are different states.
- The email sync's anchor is **address discovery**: a sync that matches zero
  messages is healthy only if the unmatched-senders list is empty too. Use
  `npm run gmail:diagnose` to see whether roster addresses appear in the
  mailbox at all.
- Counter-metrics: outreach volume is paired with reply rate (worklist +
  timeline), follow-ups sent with `no_response` closes and reopens.
- Measurement decay: imported sheet rows have unknown dates and are flagged
  as such, never given an invented follow-up clock (`datesAreMigrated`).

## Working rules for agents

- When a bug is found, add a **negative test** for it in the relevant verify
  script before fixing it. The verify scripts are the memory of what broke.
- Never mark work done on the strength of an edit. Run the graph.
- The watcher must be independent: spawn fresh-context reviewers; don't
  review your own diff in the same context.
- Read `README.md` for the domain model (stages, two-tier metrics, loops) and
  `.claude/skills/verify-creator-tool/SKILL.md` for the exact commands.
