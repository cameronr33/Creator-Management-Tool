ALTER TABLE "cm_message_templates" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "cm_outreach_events" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "cm_outreach_events" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "cm_outreach_events" ADD COLUMN "thread_id" text;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "outreach_reason" text;--> statement-breakpoint
CREATE INDEX "cm_outreach_thread_idx" ON "cm_outreach_events" USING btree ("thread_id");--> statement-breakpoint
ALTER TABLE "cm_outreach_events" ADD CONSTRAINT "cm_outreach_external_uq" UNIQUE("external_id");