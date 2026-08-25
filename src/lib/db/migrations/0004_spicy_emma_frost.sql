CREATE TABLE "cm_gmail_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scope" text,
	"connected_by" uuid,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"last_sync_at" timestamp,
	"last_sync_status" text,
	"last_sync_summary" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "cm_gmail_accounts_email_uq" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "cm_gmail_accounts" ADD CONSTRAINT "cm_gmail_accounts_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;