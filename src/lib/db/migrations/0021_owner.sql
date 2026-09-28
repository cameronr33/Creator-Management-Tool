ALTER TABLE "cm_partnerships" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "cm_partnerships" ADD CONSTRAINT "cm_partnerships_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cm_partnerships_owner_idx" ON "cm_partnerships" USING btree ("owner_id");