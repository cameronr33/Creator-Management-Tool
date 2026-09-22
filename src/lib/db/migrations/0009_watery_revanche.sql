ALTER TABLE "cm_gmail_accounts" ADD COLUMN "synced_through" timestamp;--> statement-breakpoint
ALTER TABLE "cm_gmail_accounts" ADD COLUMN "sync_lease_until" timestamp;--> statement-breakpoint
ALTER TABLE "cm_gmail_accounts" ADD COLUMN "backfilled_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cm_outreach_events" ADD COLUMN "cc_address" text;--> statement-breakpoint
ALTER TABLE "cm_outreach_events" ADD COLUMN "message_id" text;