# Creator workspace implementation — September 17, 2026

This implementation applies the simplified workspace to the existing Next.js application. The separately published Sites concept remains the earlier sample-data mockup.

## Implemented

- **Today:** one row per partnership, suggested next action, Needs action / Waiting / Needs review / All views, search and campaign/stage filters, and a compact creator preview. Filters and selection survive opening a record and returning.
- **Creators:** the operational workspace is the default; the research table and pipeline board remain available.
- **Creator workspace:** Overview, Profile & research, Conversation, Agreement, Shipping, and Content sections. Existing profile editing, Instagram enrichment through Apify, full research, social profiles, email aliases, products, address/shipment editors, agreement/fee editors, briefs, and published posts remain accessible.
- **Conversation:** source labels, email subjects, message details, imported-date uncertainty, and source identifiers. A detected reply does not assert interest. No invented Gmail deep link is shown without mailbox provenance.
- **Shipments:** every existing shipment remains visible; conflicting records require review. A returned/ready shipment resurfaces work even after the stage advances to content.
- **Needs review:** selected-client record checks and a separately labelled shared-mailbox sender queue, with pagination.
- **Outreach:** compact rows with one visible composer, draft preservation while switching rows, distinct follow-up copy, editable subjects, and guards against empty or unfinished messages. Sending still happens in the operator's messaging app.
- **Campaigns:** campaign creation on the Campaigns page; aggregate fees explicitly labelled as recorded fees.
- **Email reliability:** partial fetches persist their successful results but are reported as incomplete and fail scheduled-job health. Silence-based automatic closure is suspended because the mailbox cannot prove full conversation coverage; overdue unanswered outreach is reviewed by a person.
- **Mobile:** collapsible navigation, wrapping filters and sections, and a quick-preview return path.
- **Isolated development:** reproducible PGlite/Neon HTTP preview with fictional data, separate output directories, fresh credentials, integration restrictions, and a full verification runner. See [isolated-preview.md](isolated-preview.md).

## Verification

TypeScript, ESLint, production compilation, design checks, import fidelity, existing database feature checks, and new regression tests have been run. Tests exercise the real query/write paths against isolated PostgreSQL data and clean up their fixtures. An independent review identified shipment-correction, filter-navigation, draft-race, and preview-redirect issues; regressions were added and fixes applied.

Browser checks cover profile saves and reload persistence, shipment saves with visible feedback and reload persistence, worklist filter retention, mobile layout, and unfinished-message rejection. External Gmail, Apify, and research-provider calls are disabled in the local preview; preserving their controls and application paths is not a claim that those providers were exercised.

The read-only production invariant audit still reports **one existing partnership with several shipment records**. Other audited invariants pass. The invariant was not weakened and no production rows were edited. The new review view exposes the records for evidence-based reconciliation.

## Remaining rollout work

The larger approved roadmap continues beyond this UI and reliability implementation:

- Assigned owners, editable next actions, due dates, and personal work queues.
- Structured contract documents/signatures, expected deliverables and approval rounds, payment/invoice tracking, currency, and reconciliation.
- Verified mailbox/thread attribution, reconciliation of manually logged and synced messages, resumable backfills, and incremental mailbox checkpoints.
- Gmail-based suggestions for lifecycle facts with evidence and human correction.
- Reconciliation of HELLA's live records and restoration/confirmation of scheduled-job health.
- Organization membership and access control, independent customer mailboxes, onboarding, and industry-wide launch validation.

The current preview does not represent those remaining workflows as implemented. The application remains an internal agency tool until organization isolation and provider readiness are completed.
