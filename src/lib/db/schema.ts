import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  uuid,
  integer,
  bigint,
  boolean,
  jsonb,
  numeric,
  date,
  index,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────
// Shared tables — these already exist in the Neon instance and are
// owned by other apps. Re-declared here only so cm_* tables can
// reference them. drizzle.config.ts uses tablesFilter: ["cm_*"], so
// drizzle-kit will never try to create or alter them.
// ─────────────────────────────────────────────────────────────────

/**
 * Owned by Bulk Ads Uploader. One login across all agency tools.
 *
 * `role` is the existing `user_role` enum in the DB, but we type it as text here
 * on purpose: this table is filtered out of `drizzle-kit push` (tablesFilter),
 * and re-declaring the enum would make push try to reconcile it against the
 * live one and stall on an interactive rename prompt. Text is read-compatible.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").default("member").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Owned by social-analytics-dashboard. Shared client roster (HELLA, MEYLE…). */
export const clients = pgTable("sa_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  brandKit: jsonb("brand_kit"),
  logoUrl: text("logo_url"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────

/**
 * The stage answers exactly one question: what is this partnership
 * waiting on right now. Shipping status lives in cm_shipments, post
 * status in cm_deliverables, contract status in agreementType — none
 * of it is duplicated here.
 *
 * The app uses seven active stages and three closed ones (src/lib/stages.ts
 * is the source of truth for labels and order). Four values below are
 * RETIRED — kept only because Postgres can't cheaply drop enum values:
 * researched → shortlisted, negotiating → in_conversation,
 * agreed → awaiting_address, completed → posted. Nothing writes them.
 */
export const cmStageEnum = pgEnum("cm_stage", [
  "researched", // retired
  "shortlisted", // "To contact"
  "contacted",
  "in_conversation", // "Talking"
  "negotiating", // retired
  "agreed", // retired
  "awaiting_address", // "Agreed"
  "fulfilling", // "Ready to ship"
  "shipped", // "Shipped" (added 2026-09-23)
  "content_pending", // "Waiting on video"
  "posted",
  "completed", // retired
  // Terminal — collapse into one "Closed" column on the board.
  "passed", // we ended it
  "declined", // they ended it
  "no_response", // went quiet; always closed by a person
]);

export const cmAgreementTypeEnum = pgEnum("cm_agreement_type", [
  "verbal",
  "signed",
]);

export const cmCompensationTypeEnum = pgEnum("cm_compensation_type", [
  "free_product",
  "flat_fee",
  "hybrid",
]);

export const cmExitReasonEnum = pgEnum("cm_exit_reason", [
  // we passed
  "research_fit", // cut at the research stage on fit/cadence, before any outreach
  "below_cadence",
  "wrong_pillar",
  "fee_too_high",
  "budget",
  // they passed
  "not_interested",
  "competitor_conflict",
  "wants_more_money",
  // neither
  "went_dark",
  "other",
]);

export const cmPlatformEnum = pgEnum("cm_platform", [
  "instagram",
  "tiktok",
  "youtube",
  // Added for manually-entered creators, who may only have a Facebook page or
  // a website. Only the first three are fetchable by the Apify tier-1 enrich.
  "facebook",
  "x",
  "website",
  "other",
]);

export const cmOutreachDirectionEnum = pgEnum("cm_outreach_direction", [
  "outbound",
  "inbound",
]);

export const cmOutreachChannelEnum = pgEnum("cm_outreach_channel", [
  "ig_dm",
  "email",
  "phone",
  "other",
]);

export const cmOutreachKindEnum = pgEnum("cm_outreach_kind", [
  "initial",
  "follow_up",
  "reply",
  "note",
]);

export const cmShipmentStatusEnum = pgEnum("cm_shipment_status", [
  "ready",
  "shipped",
  "delivered",
  "returned",
]);

/**
 * Which pipeline produced a view count. Step 5 of the creator-research
 * skill is explicit that Apify's videoPlayCount is NOT Instagram's public
 * Views number — on viral reels they differ by 100x. Anything labelled
 * "apify" is provisional and must not go into a client-facing report.
 */
export const cmMetricsSourceEnum = pgEnum("cm_metrics_source", [
  "ig_public_chrome",
  "apify",
]);

export const cmAlertTypeEnum = pgEnum("cm_alert_type", [
  "initial_outreach_due",
  "follow_up_1_due",
  "follow_up_2_due",
]);

export const cmAlertStatusEnum = pgEnum("cm_alert_status", [
  "open",
  "snoozed",
  "done",
]);

export const cmResearchSourceEnum = pgEnum("cm_research_source", [
  "skill_api",
  "csv_upload",
]);

export const cmResearchStatusEnum = pgEnum("cm_research_status", [
  "running",
  "completed",
  "failed",
]);

/**
 * Lifecycle of a "Full Analysis" request. `completed`/`quickPassAt` on
 * cm_research_requests distinguishes the instant Apify-only pass from this
 * status, which tracks the ACCURATE pass a local machine must run — see the
 * cm_research_requests comment below.
 */
export const cmResearchRequestStatusEnum = pgEnum("cm_research_request_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

// ─────────────────────────────────────────────────────────────────
// cm_campaigns
// ─────────────────────────────────────────────────────────────────

export const cmCampaigns = pgTable(
  "cm_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique("cm_campaigns_client_name_uq").on(t.clientId, t.name),
    // "Summer" and "summer " are one campaign: imports and the add form match
    // names ignoring case, and this makes a racing duplicate impossible.
    uniqueIndex("cm_campaigns_client_lower_name_uq").on(t.clientId, sql`lower(${t.name})`),
  ],
);

// ─────────────────────────────────────────────────────────────────
// cm_creators — identity + research snapshot. Reusable across campaigns.
// ─────────────────────────────────────────────────────────────────

export const cmCreators = pgTable(
  "cm_creators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    username: text("username").notNull(),
    profileUrl: text("profile_url").notNull(),
    platform: cmPlatformEnum("platform").default("instagram").notNull(),
    businessEmail: text("business_email"),
    contentPillar: text("content_pillar"),

    // Research metrics (Steps 2-6 of the creator-research skill)
    followers: integer("followers"),
    reelsPulled: integer("reels_pulled"),
    cadencePerWeek: numeric("cadence_per_week", { precision: 6, scale: 2 }),
    dateRangeStart: date("date_range_start"),
    dateRangeEnd: date("date_range_end"),
    avgViews: bigint("avg_views", { mode: "number" }),
    medianViews: bigint("median_views", { mode: "number" }),
    maxViews: bigint("max_views", { mode: "number" }),
    viewsSource: cmMetricsSourceEnum("views_source"),
    contentTypeSummary: text("content_type_summary"),

    researchedAt: timestamp("researched_at"),
    lastRefreshedAt: timestamp("last_refreshed_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("cm_creators_client_username_uq").on(t.clientId, t.username),
    index("cm_creators_client_idx").on(t.clientId),
    index("cm_creators_refreshed_idx").on(t.lastRefreshedAt),
    // The sort behind every list page.
    index("cm_creators_client_followers_idx").on(t.clientId, t.followers.desc().nullsLast()),
    // The email roster's businessEmail lookup.
    index("cm_creators_business_email_idx")
      .on(t.businessEmail)
      .where(sql`${t.businessEmail} is not null`),
  ],
);

// ─────────────────────────────────────────────────────────────────
// cm_creator_socials — every profile link a creator has.
//
// cmCreators.profileUrl/platform stay as a denormalized pointer to the primary
// link so the grid and detail header keep working unchanged; this table is the
// full set (Instagram + Facebook + TikTok + website…).
// ─────────────────────────────────────────────────────────────────

export const cmCreatorSocials = pgTable(
  "cm_creator_socials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => cmCreators.id, { onDelete: "cascade" }),
    platform: cmPlatformEnum("platform").notNull(),
    url: text("url").notNull(),
    /** Handle without the @, lowercased. Null for bare websites. */
    handle: text("handle"),
    isPrimary: boolean("is_primary").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique("cm_creator_socials_creator_url_uq").on(t.creatorId, t.url),
    index("cm_creator_socials_creator_idx").on(t.creatorId),
  ],
);

// ─────────────────────────────────────────────────────────────────
// cm_creator_reels — normalizes the 9 flat "Top Reel #N" sheet columns
// ─────────────────────────────────────────────────────────────────

export const cmCreatorReels = pgTable(
  "cm_creator_reels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => cmCreators.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    shortcode: text("shortcode"),
    url: text("url").notNull(),
    views: bigint("views", { mode: "number" }),
    description: text("description"),
    capturedAt: timestamp("captured_at").defaultNow().notNull(),
  },
  (t) => [
    unique("cm_creator_reels_creator_rank_uq").on(t.creatorId, t.rank),
    index("cm_creator_reels_creator_idx").on(t.creatorId),
  ],
);

// ─────────────────────────────────────────────────────────────────
// cm_partnerships — one creator x one campaign. The pipeline row.
// ─────────────────────────────────────────────────────────────────

export const cmPartnerships = pgTable(
  "cm_partnerships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => cmCreators.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => cmCampaigns.id, { onDelete: "cascade" }),

    stage: cmStageEnum("stage").default("shortlisted").notNull(),

    // Agreement. verbal vs signed is an attribute, not a stage — a creator
    // who is signed AND shipped must not lose the fact that they signed.
    agreementType: cmAgreementTypeEnum("agreement_type"),
    agreedTerms: text("agreed_terms"),

    // Recorded, not managed. No invoice or paid/unpaid status by design —
    // payment lives in the accounting system.
    compensationType: cmCompensationTypeEnum("compensation_type").default(
      "free_product",
    ),
    feeAmount: numeric("fee_amount", { precision: 10, scale: 2 }),

    // Brief sent -> posted. No draft-approval step.
    briefSentAt: timestamp("brief_sent_at"),
    briefUrl: text("brief_url"),

    // Shipping address. Lives here because it is "where this creator's
    // product goes for this campaign", not a property of the creator.
    recipientName: text("recipient_name"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country").default("US"),
    /** Original single-line address string, kept when parsing was imperfect. */
    addressRaw: text("address_raw"),

    exitReason: cmExitReasonEnum("exit_reason"),
    notes: text("notes"),
    /**
     * Per-campaign personalization used as {{reason}} in outreach templates
     * ("loved your brake-swap reel"). Belongs to this pitch, not the creator
     * identity — the same creator in another campaign gets a fresh reason.
     */
    outreachReason: text("outreach_reason"),

    // What the latest email says — written by email-status.ts after each
    // check that brought new mail (never during a page render).
    /** One plain line: what the most recent message says. */
    emailSummary: text("email_summary"),
    /** When that most recent message was sent. */
    emailSummaryAt: timestamp("email_summary_at"),
    /** "us" (they're waiting on us), "them" (we're waiting), or "none". */
    emailWhoseTurn: text("email_whose_turn"),
    /** When the conversation was last read — re-read when newer mail is stored. */
    emailAssessedAt: timestamp("email_assessed_at"),
    /** Their latest message sounds like a no. Flagged; a person closes the deal. */
    emailSoundsLikeNo: boolean("email_sounds_like_no").default(false).notNull(),
    /** A shipping address the creator wrote in an email, offered as "Use it". */
    suggestedAddress: text("suggested_address"),
    suggestedAddressEventId: uuid("suggested_address_event_id"),
    /** "No reply needed": hides the Your-turn row until they write again. */
    replyHandledAt: timestamp("reply_handled_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("cm_partnerships_creator_campaign_uq").on(t.creatorId, t.campaignId),
    index("cm_partnerships_stage_idx").on(t.stage),
    index("cm_partnerships_campaign_idx").on(t.campaignId),
    // Email roster: most recently updated open partnership per creator.
    index("cm_partnerships_creator_updated_idx").on(t.creatorId, t.updatedAt.desc()),
  ],
);

// ─────────────────────────────────────────────────────────────────
// cm_outreach_events — the timeline replacing Messaged / FU1 / FU2.
// Follow-up count, lastContactAt and repliedAt are all derived from here.
// ─────────────────────────────────────────────────────────────────

export const cmOutreachEvents = pgTable(
  "cm_outreach_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnershipId: uuid("partnership_id")
      .notNull()
      .references(() => cmPartnerships.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    direction: cmOutreachDirectionEnum("direction").notNull(),
    channel: cmOutreachChannelEnum("channel").default("ig_dm").notNull(),
    kind: cmOutreachKindEnum("kind").notNull(),
    body: text("body"),
    /** Email subject line; null for DMs and manually logged touchpoints. */
    subject: text("subject"),
    /** Synced email only: the From header ("Name <address>"). */
    fromAddress: text("from_address"),
    /** Synced email only: the To header, comma-separated. */
    toAddress: text("to_address"),
    /** Synced email only: the Cc header, comma-separated. */
    ccAddress: text("cc_address"),
    /** Synced email only: the RFC 822 Message-ID — "Open in Gmail" searches by it. */
    messageId: text("message_id"),
    /**
     * Synced email only: who wrote it — "team" (us), "creator", or "other"
     * (someone else on the creator's thread: a manager, a parent). Only the
     * creator's own messages count as "they replied".
     */
    senderRole: text("sender_role"),
    /**
     * External message id for synced events (Gmail message id). Unique so
     * re-running the email sync is idempotent — Postgres unique constraints
     * allow many NULLs, so UI-created rows are unaffected.
     */
    externalId: text("external_id"),
    /** External thread id (Gmail thread id) for grouping synced messages. */
    threadId: text("thread_id"),
    /** True for rows synthesized by the one-time HELLA sheet import, whose real dates are unknown. */
    isMigrated: boolean("is_migrated").default(false).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("cm_outreach_partnership_idx").on(t.partnershipId),
    index("cm_outreach_occurred_idx").on(t.occurredAt),
    unique("cm_outreach_external_uq").on(t.externalId),
    index("cm_outreach_thread_idx").on(t.threadId),
    // The outreach-state aggregate and the timeline both filter by
    // partnership then split/sort by these — the fastest-growing table.
    index("cm_outreach_partnership_direction_idx").on(t.partnershipId, t.direction),
    index("cm_outreach_partnership_occurred_idx").on(t.partnershipId, t.occurredAt.desc()),
  ],
);

// ─────────────────────────────────────────────────────────────────
// cm_products_requested — one row per product, so "two of each (full car)"
// and "10 sets of wipers for her fleet" stop living in a single cell.
// ─────────────────────────────────────────────────────────────────

export const cmProductsRequested = pgTable(
  "cm_products_requested",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnershipId: uuid("partnership_id")
      .notNull()
      .references(() => cmPartnerships.id, { onDelete: "cascade" }),
    productName: text("product_name").notNull(),
    productUrl: text("product_url"),
    category: text("category"),
    quantity: integer("quantity").default(1).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("cm_products_partnership_idx").on(t.partnershipId)],
);

// ─────────────────────────────────────────────────────────────────
// cm_shipments — sole source of truth for "did it ship"
// ─────────────────────────────────────────────────────────────────

export const cmShipments = pgTable(
  "cm_shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnershipId: uuid("partnership_id")
      .notNull()
      .references(() => cmPartnerships.id, { onDelete: "cascade" }),
    status: cmShipmentStatusEnum("status").default("ready").notNull(),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    shippedAt: timestamp("shipped_at"),
    deliveredAt: timestamp("delivered_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("cm_shipments_partnership_idx").on(t.partnershipId),
    index("cm_shipments_status_idx").on(t.status),
  ],
);

// ─────────────────────────────────────────────────────────────────
// cm_deliverables — replaces Video Created + Video Link.
// Multiple posts per partnership are normal.
// ─────────────────────────────────────────────────────────────────

export const cmDeliverables = pgTable(
  "cm_deliverables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnershipId: uuid("partnership_id")
      .notNull()
      .references(() => cmPartnerships.id, { onDelete: "cascade" }),
    platform: cmPlatformEnum("platform").default("instagram").notNull(),
    url: text("url").notNull(),
    shortcode: text("shortcode"),
    postedAt: timestamp("posted_at"),
    caption: text("caption"),
    views: bigint("views", { mode: "number" }),
    likes: integer("likes"),
    comments: integer("comments"),
    metricsSource: cmMetricsSourceEnum("metrics_source"),
    metricsRefreshedAt: timestamp("metrics_refreshed_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("cm_deliverables_partnership_idx").on(t.partnershipId),
    index("cm_deliverables_posted_idx").on(t.postedAt),
    index("cm_deliverables_partnership_posted_idx").on(t.partnershipId, t.postedAt.desc()),
  ],
);

// ─────────────────────────────────────────────────────────────────
// cm_alerts — output of the follow-up loop
// ─────────────────────────────────────────────────────────────────

export const cmAlerts = pgTable(
  "cm_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnershipId: uuid("partnership_id")
      .notNull()
      .references(() => cmPartnerships.id, { onDelete: "cascade" }),
    type: cmAlertTypeEnum("type").notNull(),
    dueAt: timestamp("due_at").defaultNow().notNull(),
    status: cmAlertStatusEnum("status").default("open").notNull(),
    snoozedUntil: timestamp("snoozed_until"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    // One open alert of a given type per partnership — the cron is idempotent.
    unique("cm_alerts_partnership_type_uq").on(t.partnershipId, t.type),
    index("cm_alerts_status_idx").on(t.status),
  ],
);

// ─────────────────────────────────────────────────────────────────
// cm_message_templates — the outreach copy that currently lives in a
// spreadsheet header cell
// ─────────────────────────────────────────────────────────────────

export const cmMessageTemplates = pgTable(
  "cm_message_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    channel: cmOutreachChannelEnum("channel").default("ig_dm").notNull(),
    /** Email subject line (placeholders supported); null for DM templates. */
    subject: text("subject"),
    /** Supports {{name}}, {{content_descriptor}}, {{reason}} placeholders. */
    body: text("body").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("cm_templates_client_idx").on(t.clientId)],
);

// ─────────────────────────────────────────────────────────────────
// cm_research_runs — ingestion audit trail
// ─────────────────────────────────────────────────────────────────

export const cmResearchRuns = pgTable(
  "cm_research_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => cmCampaigns.id, {
      onDelete: "set null",
    }),
    source: cmResearchSourceEnum("source").notNull(),
    status: cmResearchStatusEnum("status").default("running").notNull(),
    handleCount: integer("handle_count").default(0).notNull(),
    createdCount: integer("created_count").default(0).notNull(),
    updatedCount: integer("updated_count").default(0).notNull(),
    rawPayload: jsonb("raw_payload"),
    errors: jsonb("errors"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("cm_research_runs_client_idx").on(t.clientId),
    index("cm_research_runs_client_started_idx").on(t.clientId, t.startedAt.desc()),
  ],
);

// ─────────────────────────────────────────────────────────────────
// cm_job_runs — heartbeat for every background loop.
//
// A cron that dies is otherwise indistinguishable from one with nothing to
// do: the dashboard keeps recomputing plausible queues and nothing turns red.
// Each /api/cron/* handler writes a row here (status ok / idle / error) so
// Settings can show "last ran X ago" and flag a loop that is overdue.
// ─────────────────────────────────────────────────────────────────

export const cmJobRuns = pgTable(
  "cm_job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "follow_ups" | "email_sync" | "refresh_metrics" */
    job: text("job").notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    /** "ok" (did work) | "idle" (nothing to do — still a healthy run) | "error" */
    status: text("status").default("running").notNull(),
    summary: jsonb("summary"),
    error: text("error"),
  },
  (t) => [index("cm_job_runs_job_started_idx").on(t.job, t.startedAt.desc())],
);

export type CmJobRun = typeof cmJobRuns.$inferSelect;

// ─────────────────────────────────────────────────────────────────
// cm_research_requests — "Full Analysis" button state.
//
// Two passes write into this one row: the instant server-side Apify pass
// (quickPassAt) fills in provisional data with viewsSource="apify" the
// moment the button is clicked; `status` tracks the slower ACCURATE pass — a
// local machine's Chrome-grid scrape + vision descriptions — which a runner
// polling GET /api/research-requests picks up, sets `running`, then
// `completed`/`failed` once it has pushed real data via /api/ingest/research
// (linked back here as researchRunId).
// ─────────────────────────────────────────────────────────────────

export const cmResearchRequests = pgTable(
  "cm_research_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => cmCreators.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => cmCampaigns.id, { onDelete: "cascade" }),
    status: cmResearchRequestStatusEnum("status").default("queued").notNull(),
    requestedBy: uuid("requested_by").references(() => users.id),
    requestedAt: timestamp("requested_at").defaultNow().notNull(),
    /** Stamped when the instant Apify-only pass finishes (usually seconds after requestedAt). */
    quickPassAt: timestamp("quick_pass_at"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    error: text("error"),
    researchRunId: uuid("research_run_id").references(() => cmResearchRuns.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("cm_research_requests_status_idx").on(t.status),
    index("cm_research_requests_creator_idx").on(t.creatorId),
  ],
);

// ─────────────────────────────────────────────────────────────────
// cm_gmail_accounts — the app's own Gmail connection for the email sync.
//
// The sync must work for every teammate with no Claude session anywhere in
// the loop, so the app holds a read-only OAuth grant itself. The refresh
// token is AES-256-GCM encrypted at rest via src/lib/encryption.ts
// (TOKEN_ENCRYPTION_KEY). One active row expected; connecting again
// replaces it.
// ─────────────────────────────────────────────────────────────────

export const cmGmailAccounts = pgTable(
  "cm_gmail_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The connected mailbox address, from Gmail's profile endpoint. */
    email: text("email").notNull(),
    /** Encrypted OAuth refresh token ("iv:tag:ciphertext" hex format). */
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    scope: text("scope"),
    connectedBy: uuid("connected_by").references(() => users.id),
    connectedAt: timestamp("connected_at").defaultNow().notNull(),
    lastSyncAt: timestamp("last_sync_at"),
    /** "ok" or an error message from the most recent sync attempt. */
    lastSyncStatus: text("last_sync_status"),
    /** Result of the last sync: {inserted, skipped, unmatched, stageChanges}. */
    lastSyncSummary: jsonb("last_sync_summary"),
    isActive: boolean("is_active").default(true).notNull(),
    /**
     * Mail up to here has been fully checked for every searched address. Only
     * advances after a COMPLETE run — a partial or failed check leaves it, so
     * the next check re-covers the gap (message ids make that harmless).
     */
    syncedThrough: timestamp("synced_through"),
    /** Held while a check runs; every trigger (cron, visit, button, new address) shares it. */
    syncLeaseUntil: timestamp("sync_lease_until"),
    /**
     * Creator addresses whose 180-day history has been searched. An address
     * not in this list — newly added anywhere — gets that search on the next
     * check; the rest only need mail since `syncedThrough`.
     */
    backfilledAddresses: jsonb("backfilled_addresses").$type<string[]>().default([]).notNull(),
    /**
     * "Our side" beyond the mailbox and the logins: teammates or client staff
     * who email creators from other addresses. Entries are addresses or
     * "@domain.com".
     */
    teamAddresses: jsonb("team_addresses").$type<string[]>().default([]).notNull(),
  },
  (t) => [unique("cm_gmail_accounts_email_uq").on(t.email)],
);

export type CmGmailAccount = typeof cmGmailAccounts.$inferSelect;

// ─────────────────────────────────────────────────────────────────
// cm_creator_emails — every address a creator is known to use.
//
// cmCreators.businessEmail is the single Apify-scraped PUBLIC address, which
// is frequently not the address a creator actually replies from. The email
// sync matches threads against the union of businessEmail and these rows,
// so linking a discovered address here is what makes a creator's threads
// start syncing.
// ─────────────────────────────────────────────────────────────────

export const cmCreatorEmails = pgTable(
  "cm_creator_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => cmCreators.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    /** "manual" | "apify" | "sync" — where the address came from. */
    source: text("source").default("manual").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique("cm_creator_emails_creator_email_uq").on(t.creatorId, t.email),
    index("cm_creator_emails_email_idx").on(t.email),
  ],
);

export type CmCreatorEmail = typeof cmCreatorEmails.$inferSelect;

// ─────────────────────────────────────────────────────────────────
// cm_email_suggestions — external addresses seen on cc'd outreach threads
// that match no creator yet. The sync's "anchor": a sync that finds nothing
// is only healthy if this list is empty too. The operator links each one to
// a creator (→ cm_creator_emails) or ignores it.
// ─────────────────────────────────────────────────────────────────

export const cmEmailSuggestionStatusEnum = pgEnum("cm_email_suggestion_status", [
  "open",
  "linked",
  "ignored",
]);

export const cmEmailSuggestions = pgTable(
  "cm_email_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    messageCount: integer("message_count").default(0).notNull(),
    firstSeenAt: timestamp("first_seen_at"),
    lastSeenAt: timestamp("last_seen_at"),
    sampleSubject: text("sample_subject"),
    /** Best-guess creator from name/handle similarity; the operator confirms. */
    suggestedCreatorId: uuid("suggested_creator_id").references(() => cmCreators.id, {
      onDelete: "set null",
    }),
    linkedCreatorId: uuid("linked_creator_id").references(() => cmCreators.id, {
      onDelete: "set null",
    }),
    status: cmEmailSuggestionStatusEnum("status").default("open").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("cm_email_suggestions_email_uq").on(t.email),
    index("cm_email_suggestions_status_idx").on(t.status),
  ],
);

export type CmEmailSuggestion = typeof cmEmailSuggestions.$inferSelect;

// ─────────────────────────────────────────────────────────────────
// cm_client_settings — per-client knobs owned by THIS app.
//
// sa_clients is shared with the analytics dashboard, so anything that is
// only true for Creator Manager (which clients this tool shows, follow-up
// cadence) lives here instead of on the shared row.
// ─────────────────────────────────────────────────────────────────

export const cmClientSettings = pgTable("cm_client_settings", {
  clientId: uuid("client_id")
    .primaryKey()
    .references(() => clients.id, { onDelete: "cascade" }),
  /** Hide the client from Creator Manager without touching the shared roster. */
  hidden: boolean("hidden").default(false).notNull(),
  /**
   * Overrides for src/lib/outreach.ts DEFAULT_THRESHOLDS, e.g.
   * {"initialOutreachAfterDays":3,"followUp1AfterDays":5,...}. Null = defaults.
   */
  followUpThresholds: jsonb("follow_up_thresholds"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type CmClientSettings = typeof cmClientSettings.$inferSelect;

// ─────────────────────────────────────────────────────────────────
// cm_api_keys — lets the creator-research skill push results in
// ─────────────────────────────────────────────────────────────────

export const cmApiKeys = pgTable("cm_api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** SHA-256 of the raw key. The raw key is shown once at creation. */
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────
// cm_stage_transitions — makes "when did this become signed" answerable
// ─────────────────────────────────────────────────────────────────

export const cmStageTransitions = pgTable(
  "cm_stage_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnershipId: uuid("partnership_id")
      .notNull()
      .references(() => cmPartnerships.id, { onDelete: "cascade" }),
    fromStage: cmStageEnum("from_stage"),
    toStage: cmStageEnum("to_stage").notNull(),
    changedBy: uuid("changed_by").references(() => users.id),
    changedAt: timestamp("changed_at").defaultNow().notNull(),
    /**
     * Who moved it: "manual" (a person), "rule" (the auto-stage table),
     * "email" (read from the creator's latest email), or "migration".
     * Rows written before this column existed are null and read as manual —
     * the conservative reading for "a manual change wins".
     */
    source: text("source"),
    /** Plain-words why: the rule that fired, or the quote from the email. */
    reason: text("reason"),
    /** The message that justified an email-read move. */
    evidenceEventId: uuid("evidence_event_id").references(() => cmOutreachEvents.id, { onDelete: "set null" }),
    /** What the move created (shipment, video record), so Undo can take it back. */
    meta: jsonb("meta"),
    /** Set when someone pressed Undo on this move. */
    undoneAt: timestamp("undone_at"),
  },
  (t) => [index("cm_transitions_partnership_idx").on(t.partnershipId)],
);

// ─────────────────────────────────────────────────────────────────
// Inferred types
// ─────────────────────────────────────────────────────────────────

export type Client = typeof clients.$inferSelect;
export type CmCampaign = typeof cmCampaigns.$inferSelect;
export type CmCreator = typeof cmCreators.$inferSelect;
export type CmCreatorReel = typeof cmCreatorReels.$inferSelect;
export type CmCreatorSocial = typeof cmCreatorSocials.$inferSelect;
export type CmPartnership = typeof cmPartnerships.$inferSelect;
export type CmOutreachEvent = typeof cmOutreachEvents.$inferSelect;
export type CmProductRequested = typeof cmProductsRequested.$inferSelect;
export type CmShipment = typeof cmShipments.$inferSelect;
export type CmDeliverable = typeof cmDeliverables.$inferSelect;
export type CmAlert = typeof cmAlerts.$inferSelect;
export type CmMessageTemplate = typeof cmMessageTemplates.$inferSelect;
export type CmResearchRun = typeof cmResearchRuns.$inferSelect;
export type CmResearchRequest = typeof cmResearchRequests.$inferSelect;
export type CmResearchRequestStatus = (typeof cmResearchRequestStatusEnum.enumValues)[number];
export type CmStage = (typeof cmStageEnum.enumValues)[number];
export type CmAlertType = (typeof cmAlertTypeEnum.enumValues)[number];

export type CmStageTransition = typeof cmStageTransitions.$inferSelect;
