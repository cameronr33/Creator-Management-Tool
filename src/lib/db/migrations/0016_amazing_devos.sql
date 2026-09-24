CREATE TYPE "public"."cm_client_approval" AS ENUM('pending', 'approved', 'passed');--> statement-breakpoint
ALTER TYPE "public"."cm_exit_reason" ADD VALUE 'client_passed' BEFORE 'not_interested';--> statement-breakpoint
CREATE TABLE "cm_client_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"login_enabled" boolean DEFAULT false NOT NULL,
	"invite_token_hash" text,
	"invite_expires_at" timestamp,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cm_client_users_email_uq" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "cm_client_settings" ADD COLUMN "requires_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "client_approval" "cm_client_approval";--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "approval_by_name" text;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "approval_at" timestamp;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "approval_note" text;--> statement-breakpoint
ALTER TABLE "cm_client_users" ADD CONSTRAINT "cm_client_users_client_id_sa_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."sa_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cm_client_users_client_idx" ON "cm_client_users" USING btree ("client_id");