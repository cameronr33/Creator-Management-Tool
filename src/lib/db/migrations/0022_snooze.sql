ALTER TABLE "cm_partnerships" ADD COLUMN "snoozed_until" timestamp;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "snoozed_at" timestamp;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "snooze_stage" "cm_stage";--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "snooze_reason" text;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "snoozed_by_name" text;