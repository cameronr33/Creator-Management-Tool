CREATE TABLE "cm_creator_photos" (
	"creator_id" uuid PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"data" text NOT NULL,
	"source_url" text,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cm_creator_photos" ADD CONSTRAINT "cm_creator_photos_creator_id_cm_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."cm_creators"("id") ON DELETE cascade ON UPDATE no action;