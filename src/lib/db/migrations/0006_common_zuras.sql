CREATE TABLE "cm_job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"status" text DEFAULT 'running' NOT NULL,
	"summary" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "cm_job_runs_job_started_idx" ON "cm_job_runs" USING btree ("job","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cm_creators_client_followers_idx" ON "cm_creators" USING btree ("client_id","followers" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cm_creators_business_email_idx" ON "cm_creators" USING btree ("business_email") WHERE "cm_creators"."business_email" is not null;--> statement-breakpoint
CREATE INDEX "cm_deliverables_partnership_posted_idx" ON "cm_deliverables" USING btree ("partnership_id","posted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cm_outreach_partnership_direction_idx" ON "cm_outreach_events" USING btree ("partnership_id","direction");--> statement-breakpoint
CREATE INDEX "cm_outreach_partnership_occurred_idx" ON "cm_outreach_events" USING btree ("partnership_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cm_partnerships_creator_updated_idx" ON "cm_partnerships" USING btree ("creator_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cm_research_runs_client_started_idx" ON "cm_research_runs" USING btree ("client_id","started_at" DESC NULLS LAST);