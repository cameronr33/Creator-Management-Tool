CREATE TYPE "public"."cm_research_request_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "cm_research_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"status" "cm_research_request_status" DEFAULT 'queued' NOT NULL,
	"requested_by" uuid,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"quick_pass_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"error" text,
	"research_run_id" uuid
);
--> statement-breakpoint
ALTER TABLE "cm_research_requests" ADD CONSTRAINT "cm_research_requests_creator_id_cm_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."cm_creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_research_requests" ADD CONSTRAINT "cm_research_requests_client_id_sa_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."sa_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_research_requests" ADD CONSTRAINT "cm_research_requests_campaign_id_cm_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."cm_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_research_requests" ADD CONSTRAINT "cm_research_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_research_requests" ADD CONSTRAINT "cm_research_requests_research_run_id_cm_research_runs_id_fk" FOREIGN KEY ("research_run_id") REFERENCES "public"."cm_research_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cm_research_requests_status_idx" ON "cm_research_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cm_research_requests_creator_idx" ON "cm_research_requests" USING btree ("creator_id");