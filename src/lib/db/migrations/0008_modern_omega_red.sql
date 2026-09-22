ALTER TABLE "cm_partnerships" ALTER COLUMN "stage" SET DEFAULT 'shortlisted';--> statement-breakpoint
ALTER TABLE "cm_stage_transitions" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "cm_stage_transitions" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "cm_stage_transitions" ADD COLUMN "evidence_event_id" uuid;--> statement-breakpoint
ALTER TABLE "cm_stage_transitions" ADD COLUMN "meta" jsonb;--> statement-breakpoint
ALTER TABLE "cm_stage_transitions" ADD COLUMN "undone_at" timestamp;--> statement-breakpoint
ALTER TABLE "cm_stage_transitions" ADD CONSTRAINT "cm_stage_transitions_evidence_event_id_cm_outreach_events_id_fk" FOREIGN KEY ("evidence_event_id") REFERENCES "public"."cm_outreach_events"("id") ON DELETE set null ON UPDATE no action;