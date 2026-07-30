CREATE TABLE "short_position" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"issuer_id" integer,
	"isin" text,
	"issuer_name_raw" text NOT NULL,
	"holder_name_raw" text NOT NULL,
	"position_pct" numeric NOT NULL,
	"position_date" date NOT NULL,
	"natural_key_hash" text NOT NULL,
	"raw" jsonb,
	CONSTRAINT "short_position_natural_key_hash_unique" UNIQUE("natural_key_hash")
);
--> statement-breakpoint
ALTER TABLE "short_position" ADD CONSTRAINT "short_position_issuer_id_issuer_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."issuer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "short_position_issuer_idx" ON "short_position" USING btree ("issuer_id","position_date");--> statement-breakpoint
CREATE INDEX "short_position_date_idx" ON "short_position" USING btree ("position_date");--> statement-breakpoint
CREATE INDEX "short_position_holder_idx" ON "short_position" USING btree ("holder_name_raw");