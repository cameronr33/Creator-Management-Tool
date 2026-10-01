CREATE TABLE "cm_client_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cm_client_domains_domain_uq" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "cm_creator_side_senders" (
	"email" text PRIMARY KEY NOT NULL,
	"decided_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cm_client_domains" ADD CONSTRAINT "cm_client_domains_client_id_sa_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."sa_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cm_client_domains_client_idx" ON "cm_client_domains" USING btree ("client_id");