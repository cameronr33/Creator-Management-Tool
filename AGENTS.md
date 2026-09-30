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
   (see `csv-import.ts`, `writeNumbers`).
   (2026-09-28, owner: portal views "both, clearly labelled".) The client
   portal may show a video's estimated views, always labelled: only
   `ig_public_chrome` is called verified; `apify` and a missing source are
   estimated. Verified and estimated totals are never added together
   (`portal-data.ts` `viewsKindOf`, `portal-export.ts` `portalViewTotals`).
   `verify-portal.ts` is the anchor.
2. **Automation moves a stage only forward and never closes a deal.**
   (Rewritten by the owner's decision of 2026-09-22 — "the status should be
   based off of the last email", and Claude may move it.) Two engines may
   move a stage: the rule table (`auto-stage.ts`) and the email reader
   (`email-status.ts`). Both are strict from-stage allowlists; neither sets
   `passed`/`declined`/`no_response`; the only reopen is `no_response` →
   Talking on the creator's own message sent after the close. The email
   reader also requires a verbatim quote from the cited message, that
   message newer than the last manual change, not-low confidence, an
   address for Ready to ship, the creator's own post link for Posted, and the
   `EMAIL_AUTOMOVE` switch. A "no" only raises a flag; a person closes.
   Every move records its source, quote and evidence and is undoable.
   (2026-09-24, owner: contracts and email fill in the deal.) Filling blank
   deal fields from a contract or email (`deal-facts.ts`) is not a stage
   move; its only stage effect is the existing `address_complete` rule
   (Agreed → Ready to ship) when it fills a complete address. It never
   replaces a filled field — `verify-deal-fill.ts` is its matrix.
   (2026-09-25, owner: "a stage between agreed and ready to ship ... contract
   negotiations or questions".) Finalizing: in from Agreed on an unsigned
   contract (rule `contract_unsigned`) or the creator's own email; out to
   Ready to ship only when the deal is signed and the address complete (rule
   `deal_ready`) — never by email.
   (2026-09-23, owner: "there should be a Ready to ship status" — Shipping
   split into Ready to ship → Shipped; a move to Shipped marks the shipment
   shipped. Email never moves anyone to Shipped: that is ours to mark, and it
   only moves to Waiting on video from Shipped — 2026-09-24 review finding.)
   (2026-09-28, owner: product update.) Undo on the quick buttons (I
   messaged them, They replied, Mark shipped / delivered) is a person's
   move (source manual, reason "undo"), allowed only for whoever pressed
   it, within ten minutes, while the press's move is still the latest real
   move — so a rule move made by a quick button becomes undoable; no new
   automation. The reversal is one statement with compare-and-sets (all of
   it or none) and touches only the rows the press touched. A quick undo is
   a person's say to the email reader like any other; only the backdating
   rule looks past it (and past the one-time stage clean-up): a message
   logged with a date before a person's last stage change never fires a
   rule (`logging.ts`), so a late "They replied" can't reopen a deal closed
   since. The email reader may cite only mail the mailbox holds: a DM or an
   email a teammate logged by hand is their summary, never the creator's
   own words (`fromMailbox`, review 2026-09-28). Anchors: `verify-undo.ts`,
   `verify-logging.ts`.
   (2026-09-30, owner: interaction review I14, "Undo where it was missing".)
   A stage a person picked themselves (the dropdown, a drag, a bulk move) can
   be undone by that person, within ten minutes, while it's still the latest
   move (`undoMove`; an Undo is never itself undone). Approve and Pass can be
   undone by whoever decided, at that exact moment, within ten minutes
   (`undoApproval`, `undoPass`: compare-and-set, the pass's prior approval
   kept on the server in the move's meta). Still no new automation. Anchor:
   `verify-undo.ts`.
   (2026-09-29, owner: "flag it, one click to fix".) The email reader may
   also say where the deal stands from the messages alone
   (`stage_from_messages`, with a line verified in mailbox mail). When that
   is an earlier stage than Talking / Agreed / Finalizing and newer than a
   person's last move, Today and the creator page ASK a person ("Their
   emails read as Talking, not Agreed" — Move / Keep); nothing moves
   backward by itself, and never once a shipment exists. `stage-flag.ts`;
   anchors: `verify-today.ts`, `verify-today-data.ts`, `verify-email-status.ts`.
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
- Every route states who may call it (2026-09-24, client logins): the agency's
  `requireAgency()`, the portal's `requireClientUser()` (brand from the login,
  never a cookie), the cron secret, or — for `/api/invite` only — the one-time
  invite token. `verify-access` fails on any handler without one, and
  `verify-portal` plants private values and asserts none reach the portal.
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
