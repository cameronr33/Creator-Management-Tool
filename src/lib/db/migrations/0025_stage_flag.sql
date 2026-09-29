ALTER TABLE "cm_partnerships" ADD COLUMN "email_stage" "cm_stage";--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "email_stage_quote" text;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "email_stage_event_id" uuid;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "email_stage_at" timestamp;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "stage_flag_dismissed_at" timestamp;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD CONSTRAINT "cm_partnerships_email_stage_event_id_cm_outreach_events_id_fk" FOREIGN KEY ("email_stage_event_id") REFERENCES "public"."cm_outreach_events"("id") ON DELETE set null ON UPDATE no action;