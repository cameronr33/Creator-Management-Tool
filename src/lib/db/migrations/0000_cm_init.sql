CREATE TYPE "public"."cm_agreement_type" AS ENUM('verbal', 'signed');--> statement-breakpoint
CREATE TYPE "public"."cm_alert_status" AS ENUM('open', 'snoozed', 'done');--> statement-breakpoint
CREATE TYPE "public"."cm_alert_type" AS ENUM('initial_outreach_due', 'follow_up_1_due', 'follow_up_2_due');--> statement-breakpoint
CREATE TYPE "public"."cm_compensation_type" AS ENUM('free_product', 'flat_fee', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."cm_exit_reason" AS ENUM('research_fit', 'below_cadence', 'wrong_pillar', 'fee_too_high', 'budget', 'not_interested', 'competitor_conflict', 'wants_more_money', 'went_dark', 'other');--> statement-breakpoint
CREATE TYPE "public"."cm_metrics_source" AS ENUM('ig_public_chrome', 'apify');--> statement-breakpoint
CREATE TYPE "public"."cm_outreach_channel" AS ENUM('ig_dm', 'email', 'phone', 'other');--> statement-breakpoint
CREATE TYPE "public"."cm_outreach_direction" AS ENUM('outbound', 'inbound');--> statement-breakpoint
CREATE TYPE "public"."cm_outreach_kind" AS ENUM('initial', 'follow_up', 'reply', 'note');--> statement-breakpoint
CREATE TYPE "public"."cm_platform" AS ENUM('instagram', 'tiktok', 'youtube');--> statement-breakpoint
CREATE TYPE "public"."cm_research_source" AS ENUM('skill_api', 'csv_upload');--> statement-breakpoint
CREATE TYPE "public"."cm_research_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."cm_shipment_status" AS ENUM('ready', 'shipped', 'delivered', 'returned');--> statement-breakpoint
CREATE TYPE "public"."cm_stage" AS ENUM('researched', 'shortlisted', 'contacted', 'in_conversation', 'negotiating', 'agreed', 'awaiting_address', 'fulfilling', 'content_pending', 'posted', 'completed', 'passed', 'declined', 'no_response');--> statement-breakpoint
CREATE TABLE "sa_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"brand_kit" jsonb,
	"logo_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sa_clients_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "cm_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partnership_id" uuid NOT NULL,
	"type" "cm_alert_type" NOT NULL,
	"due_at" timestamp DEFAULT now() NOT NULL,
	"status" "cm_alert_status" DEFAULT 'open' NOT NULL,
	"snoozed_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cm_alerts_partnership_type_uq" UNIQUE("partnership_id","type")
);
--> statement-breakpoint
CREATE TABLE "cm_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cm_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "cm_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cm_campaigns_client_name_uq" UNIQUE("client_id","name")
);
--> statement-breakpoint
CREATE TABLE "cm_creator_reels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"shortcode" text,
	"url" text NOT NULL,
	"views" bigint,
	"description" text,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cm_creator_reels_creator_rank_uq" UNIQUE("creator_id","rank")
);
--> statement-breakpoint
CREATE TABLE "cm_creators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"profile_url" text NOT NULL,
	"platform" "cm_platform" DEFAULT 'instagram' NOT NULL,
	"business_email" text,
	"content_pillar" text,
	"followers" integer,
	"reels_pulled" integer,
	"cadence_per_week" numeric(6, 2),
	"date_range_start" date,
	"date_range_end" date,
	"avg_views" bigint,
	"median_views" bigint,
	"max_views" bigint,
	"views_source" "cm_metrics_source",
	"content_type_summary" text,
	"researched_at" timestamp,
	"last_refreshed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cm_creators_client_username_uq" UNIQUE("client_id","username")
);
--> statement-breakpoint
CREATE TABLE "cm_deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partnership_id" uuid NOT NULL,
	"platform" "cm_platform" DEFAULT 'instagram' NOT NULL,
	"url" text NOT NULL,
	"shortcode" text,
	"posted_at" timestamp,
	"caption" text,
	"views" bigint,
	"likes" integer,
	"comments" integer,
	"metrics_source" "cm_metrics_source",
	"metrics_refreshed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cm_message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channel" "cm_outreach_channel" DEFAULT 'ig_dm' NOT NULL,
	"body" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cm_outreach_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partnership_id" uuid NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"direction" "cm_outreach_direction" NOT NULL,
	"channel" "cm_outreach_channel" DEFAULT 'ig_dm' NOT NULL,
	"kind" "cm_outreach_kind" NOT NULL,
	"body" text,
	"is_migrated" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cm_partnerships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"stage" "cm_stage" DEFAULT 'researched' NOT NULL,
	"agreement_type" "cm_agreement_type",
	"agreed_terms" text,
	"compensation_type" "cm_compensation_type" DEFAULT 'free_product',
	"fee_amount" numeric(10, 2),
	"brief_sent_at" timestamp,
	"brief_url" text,
	"recipient_name" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"country" text DEFAULT 'US',
	"address_raw" text,
	"exit_reason" "cm_exit_reason",
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cm_partnerships_creator_campaign_uq" UNIQUE("creator_id","campaign_id")
);
--> statement-breakpoint
CREATE TABLE "cm_products_requested" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partnership_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"product_url" text,
	"category" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cm_research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" uuid,
	"source" "cm_research_source" NOT NULL,
	"status" "cm_research_status" DEFAULT 'running' NOT NULL,
	"handle_count" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"raw_payload" jsonb,
	"errors" jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "cm_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partnership_id" uuid NOT NULL,
	"status" "cm_shipment_status" DEFAULT 'ready' NOT NULL,
	"carrier" text,
	"tracking_number" text,
	"shipped_at" timestamp,
	"delivered_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cm_stage_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partnership_id" uuid NOT NULL,
	"from_stage" "cm_stage",
	"to_stage" "cm_stage" NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "cm_alerts" ADD CONSTRAINT "cm_alerts_partnership_id_cm_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."cm_partnerships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_api_keys" ADD CONSTRAINT "cm_api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_campaigns" ADD CONSTRAINT "cm_campaigns_client_id_sa_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."sa_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_creator_reels" ADD CONSTRAINT "cm_creator_reels_creator_id_cm_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."cm_creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_creators" ADD CONSTRAINT "cm_creators_client_id_sa_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."sa_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_deliverables" ADD CONSTRAINT "cm_deliverables_partnership_id_cm_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."cm_partnerships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_message_templates" ADD CONSTRAINT "cm_message_templates_client_id_sa_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."sa_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_outreach_events" ADD CONSTRAINT "cm_outreach_events_partnership_id_cm_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."cm_partnerships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_outreach_events" ADD CONSTRAINT "cm_outreach_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD CONSTRAINT "cm_partnerships_creator_id_cm_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."cm_creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD CONSTRAINT "cm_partnerships_campaign_id_cm_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."cm_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_products_requested" ADD CONSTRAINT "cm_products_requested_partnership_id_cm_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."cm_partnerships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_research_runs" ADD CONSTRAINT "cm_research_runs_client_id_sa_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."sa_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_research_runs" ADD CONSTRAINT "cm_research_runs_campaign_id_cm_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."cm_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_shipments" ADD CONSTRAINT "cm_shipments_partnership_id_cm_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."cm_partnerships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_stage_transitions" ADD CONSTRAINT "cm_stage_transitions_partnership_id_cm_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."cm_partnerships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_stage_transitions" ADD CONSTRAINT "cm_stage_transitions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cm_alerts_status_idx" ON "cm_alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cm_creator_reels_creator_idx" ON "cm_creator_reels" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "cm_creators_client_idx" ON "cm_creators" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "cm_creators_refreshed_idx" ON "cm_creators" USING btree ("last_refreshed_at");--> statement-breakpoint
CREATE INDEX "cm_deliverables_partnership_idx" ON "cm_deliverables" USING btree ("partnership_id");--> statement-breakpoint
CREATE INDEX "cm_deliverables_posted_idx" ON "cm_deliverables" USING btree ("posted_at");--> statement-breakpoint
CREATE INDEX "cm_templates_client_idx" ON "cm_message_templates" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "cm_outreach_partnership_idx" ON "cm_outreach_events" USING btree ("partnership_id");--> statement-breakpoint
CREATE INDEX "cm_outreach_occurred_idx" ON "cm_outreach_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "cm_partnerships_stage_idx" ON "cm_partnerships" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "cm_partnerships_campaign_idx" ON "cm_partnerships" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "cm_products_partnership_idx" ON "cm_products_requested" USING btree ("partnership_id");--> statement-breakpoint
CREATE INDEX "cm_research_runs_client_idx" ON "cm_research_runs" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "cm_shipments_partnership_idx" ON "cm_shipments" USING btree ("partnership_id");--> statement-breakpoint
CREATE INDEX "cm_shipments_status_idx" ON "cm_shipments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cm_transitions_partnership_idx" ON "cm_stage_transitions" USING btree ("partnership_id");