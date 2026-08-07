ALTER TYPE "public"."cm_platform" ADD VALUE 'facebook';--> statement-breakpoint
ALTER TYPE "public"."cm_platform" ADD VALUE 'x';--> statement-breakpoint
ALTER TYPE "public"."cm_platform" ADD VALUE 'website';--> statement-breakpoint
ALTER TYPE "public"."cm_platform" ADD VALUE 'other';--> statement-breakpoint
CREATE TABLE "cm_creator_socials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform" "cm_platform" NOT NULL,
	"url" text NOT NULL,
	"handle" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cm_creator_socials_creator_url_uq" UNIQUE("creator_id","url")
);
--> statement-breakpoint
ALTER TABLE "cm_creator_socials" ADD CONSTRAINT "cm_creator_socials_creator_id_cm_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."cm_creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cm_creator_socials_creator_idx" ON "cm_creator_socials" USING btree ("creator_id");