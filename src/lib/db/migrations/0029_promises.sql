ALTER TABLE "cm_partnerships" ADD COLUMN "promise_text" text;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "promise_quote" text;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "promise_event_id" uuid;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "promise_at" timestamp;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "promise_done_at" timestamp;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD CONSTRAINT "cm_partnerships_promise_event_id_cm_outreach_events_id_fk" FOREIGN KEY ("promise_event_id") REFERENCES "public"."cm_outreach_events"("id") ON DELETE set null ON UPDATE no action;