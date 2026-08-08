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
 */
export const cmStageEnum = pgEnum("cm_stage", [
  "researched",
  "shortlisted",
  "contacted",
  "in_conversation",
  "negotiating",
  "agreed",
  "awaiting_address",
  "fulfilling",
  "content_pending",
  "posted",
  "completed",
  // Terminal — collapse into one "Closed" column on the board.
  "passed", // we ended it
  "declined", // they ended it
  "no_response", // went dark; set by the follow-up loop
]);

/** Stages past which a shipment record must exist. Order matters. */
export const CM_STAGE_ORDER = [
  "researched",
  "shortlisted",
  "contacted",
  "in_conversation",
  "negotiating",
  "agreed",
  "awaiting_address",
  "fulfilling",
  "content_pending",
  "posted",
  "completed",
] as const;

export const CM_TERMINAL_STAGES = ["passed", "declined", "no_response"] as const;

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
  (t) => [unique("cm_campaigns_client_name_uq").on(t.clientId, t.name)],
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

    stage: cmStageEnum("stage").default("researched").notNull(),

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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("cm_partnerships_creator_campaign_uq").on(t.creatorId, t.campaignId),
    index("cm_partnerships_stage_idx").on(t.stage),
    index("cm_partnerships_campaign_idx").on(t.campaignId),
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
    /** True for rows synthesized by import-hella.ts, whose real dates are unknown. */
    isMigrated: boolean("is_migrated").default(false).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("cm_outreach_partnership_idx").on(t.partnershipId),
    index("cm_outreach_occurred_idx").on(t.occurredAt),
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
  (t) => [index("cm_research_runs_client_idx").on(t.clientId)],
);

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
