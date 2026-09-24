CREATE TYPE "public"."cm_contract_read" AS ENUM('pending', 'reading', 'read', 'not_contract', 'failed');--> statement-breakpoint
CREATE TYPE "public"."cm_contract_source" AS ENUM('upload', 'email');--> statement-breakpoint
CREATE TABLE "cm_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partnership_id" uuid NOT NULL,
	"source" "cm_contract_source" NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" integer,
	"data" text,
	"sha256" text,
	"outreach_event_id" uuid,
	"gmail_message_id" text,
	"gmail_part_id" text,
	"uploaded_by" uuid,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"read_status" "cm_contract_read" DEFAULT 'pending' NOT NULL,
	"read_error" text,
	"extracted" jsonb,
	"filled" jsonb,
	"read_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "email_deal" jsonb;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "deal_dismissed" jsonb;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "deal_edited_at" timestamp;--> statement-breakpoint
ALTER TABLE "cm_contracts" ADD CONSTRAINT "cm_contracts_partnership_id_cm_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."cm_partnerships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_contracts" ADD CONSTRAINT "cm_contracts_outreach_event_id_cm_outreach_events_id_fk" FOREIGN KEY ("outreach_event_id") REFERENCES "public"."cm_outreach_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_contracts" ADD CONSTRAINT "cm_contracts_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cm_contracts_partnership_idx" ON "cm_contracts" USING btree ("partnership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cm_contracts_partnership_sha_uq" ON "cm_contracts" USING btree ("partnership_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "cm_contracts_gmail_part_uq" ON "cm_contracts" USING btree ("gmail_message_id","gmail_part_id");