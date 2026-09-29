CREATE TABLE "cm_team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"user_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cm_team_members_email_lower" CHECK ("cm_team_members"."email" = lower("cm_team_members"."email"))
);
--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD COLUMN "owner_member_id" uuid;--> statement-breakpoint
ALTER TABLE "cm_team_members" ADD CONSTRAINT "cm_team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cm_team_members_email_uq" ON "cm_team_members" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "cm_team_members_user_uq" ON "cm_team_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD CONSTRAINT "cm_partnerships_owner_member_id_cm_team_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."cm_team_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cm_partnerships_owner_member_idx" ON "cm_partnerships" USING btree ("owner_member_id");