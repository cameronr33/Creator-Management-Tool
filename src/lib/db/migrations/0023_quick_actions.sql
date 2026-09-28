CREATE TYPE "public"."cm_quick_action_kind" AS ENUM('message', 'shipment');--> statement-breakpoint
CREATE TABLE "cm_quick_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partnership_id" uuid NOT NULL,
	"kind" "cm_quick_action_kind" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"outreach_event_id" uuid,
	"shipment_id" uuid,
	"transition_id" uuid,
	"prior" jsonb,
	"applied" jsonb,
	"created_shipment" boolean DEFAULT false NOT NULL,
	"undone_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "cm_quick_actions" ADD CONSTRAINT "cm_quick_actions_partnership_id_cm_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."cm_partnerships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_quick_actions" ADD CONSTRAINT "cm_quick_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_quick_actions" ADD CONSTRAINT "cm_quick_actions_outreach_event_id_cm_outreach_events_id_fk" FOREIGN KEY ("outreach_event_id") REFERENCES "public"."cm_outreach_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_quick_actions" ADD CONSTRAINT "cm_quick_actions_shipment_id_cm_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."cm_shipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cm_quick_actions" ADD CONSTRAINT "cm_quick_actions_transition_id_cm_stage_transitions_id_fk" FOREIGN KEY ("transition_id") REFERENCES "public"."cm_stage_transitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cm_quick_actions_partnership_idx" ON "cm_quick_actions" USING btree ("partnership_id","created_at");