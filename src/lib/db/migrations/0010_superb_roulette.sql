ALTER TABLE "cm_gmail_accounts" ADD COLUMN "team_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cm_outreach_events" ADD COLUMN "sender_role" text;