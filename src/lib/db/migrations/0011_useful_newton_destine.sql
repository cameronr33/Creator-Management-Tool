ALTER TABLE "cm_partnerships" ADD COLUMN "email_summary" text;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "email_summary_at" timestamp;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "email_whose_turn" text;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "email_assessed_at" timestamp;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "email_sounds_like_no" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "suggested_address" text;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "suggested_address_event_id" uuid;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "reply_handled_at" timestamp;