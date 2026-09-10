CREATE TYPE "public"."cm_email_suggestion_status" AS ENUM('open', 'linked', 'ignored');--> statement-breakpoint
CREATE TABLE "cm_client_settings" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"follow_up_thresholds" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cm_creator_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"email" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cm_creator_emails_creator_email_uq" UNIQUE("creator_id","email")
);
--> statement-breakpoint
CREATE TABLE "cm_email_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"message_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp,
	"last_seen_at" timestamp,
	"sample_subject" text,
	"suggested_creator_id" uuid,
	"linked_creator_id" uuid,
	"status" "cm_email_suggestion_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cm_email_suggestions_email_uq" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "cm_client_settings" ADD CONSTRAINT "cm_client_settings_client_id_sa_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."sa_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_creator_emails" ADD CONSTRAINT "cm_creator_emails_creator_id_cm_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."cm_creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_email_suggestions" ADD CONSTRAINT "cm_email_suggestions_suggested_creator_id_cm_creators_id_fk" FOREIGN KEY ("suggested_creator_id") REFERENCES "public"."cm_creators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_email_suggestions" ADD CONSTRAINT "cm_email_suggestions_linked_creator_id_cm_creators_id_fk" FOREIGN KEY ("linked_creator_id") REFERENCES "public"."cm_creators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cm_creator_emails_email_idx" ON "cm_creator_emails" USING btree ("email");--> statement-breakpoint
CREATE INDEX "cm_email_suggestions_status_idx" ON "cm_email_suggestions" USING btree ("status");