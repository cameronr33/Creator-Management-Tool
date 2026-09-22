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
   (see `ingest.ts`, which the CSV import uses).
2. **Automation moves a stage only forward and never closes a deal.**
   (Rewritten by the owner's decision of 2026-09-22 — "the status should be
   based off of the last email", and Claude may move it.) Two engines may
   move a stage: the rule table (`auto-stage.ts`) and the email reader
   (`email-status.ts`). Both are strict from-stage allowlists; neither sets
   `passed`/`declined`/`no_response`; the only reopen is `no_response` →
   Talking on the creator's own message sent after the close. The email
   reader also requires a verbatim quote from the cited message, that
   message newer than the last manual change, not-low confidence, an
   address for Shipping, the creator's own post link for Posted, and the
   `EMAIL_AUTOMOVE` switch. A "no" only raises a flag; a person closes.
   Every move records its source, quote and evidence and is undoable.
   Matrices: `verify-auto-stage.ts` and `verify-email-status.ts`; edit the
   code and its matrix together, or neither.
3. **Verification leaves nothing behind.** Every live check cleans up in
   `finally`; `verify:invariants` asserts zero `__verify_` rows remain.
4. **Shared tables (`users`, `sa_clients`) are never altered by this app's
   migrations.** `db:apply` skips their `CREATE TABLE`; per-app knobs live in
   `cm_client_settings`, never on the shared row.
5. **Secrets never enter git.** `.env*` is ignored; every commit is content-
   scanned for secret-shaped strings before staging.
6. **A check is never weakened to make it pass.** If a check fails, the code
   or the data is wrong. If a check was wrong, say why in the commit.
7. **The UI is built only from the design tokens and primitives.** Colours
   come from `globals.css`, controls from `ui.tsx`, feedback from
   `useSave()`/`toast()`; no raw Tailwind palette classes, nothing under
   11px, no silent saves. `verify:design` is the anchor. The explanation of
   the app (`/help`, stage hints, the "Next:" line) is generated from the
   same tables the app runs on — never hand-written prose that can drift.

## Green must mean grounded

A loop reporting "ok" while doing nothing is the most expensive failure mode
here — it looks like health. So:

- Every background job writes a `cm_job_runs` heartbeat with a status of
  `ok` (did work), `idle` (nothing to do — still healthy), or `error`. The
  email card shows when the mailbox was last checked and flags a failed or
  overdue check. "Hasn't run" and "ran with nothing to do" are different states.
- The email check searches **only** for addresses saved on creators (owner
  decision, 2026-09-22 — the mailbox is a broad work inbox; nothing else is
  read or stored). Its anchors, all computed from stored rows:
  - every check (schedule, page visit, button, new address) leaves a
    heartbeat, and coverage (`synced_through`) only advances on a
    **complete** check — a partial or capped one is reported as partial
    and the next check re-covers the gap;
  - Settings lists creator addresses that were searched but have **no mail**
    (a typo or the wrong address looks exactly like a quiet creator
    otherwise) and addresses saved on **more than one creator**;
  - `npm run gmail:diagnose` shows per-address match counts in the mailbox.
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
- UI work: reach for a primitive in `src/components/ui.tsx` before writing a
  `<button>` or `<input>`; wrap every control in `Field`; save through
  `useSave()`; confirm destructive actions with `ConfirmButton`. If a new
  colour or control is needed, add the token/primitive first, then use it.
  Copy is written for a teammate on day one — plain words, who/what/next,
  no vendor names ("estimated", not "Apify").
