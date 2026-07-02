CREATE TABLE "news_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"instrument_id" integer,
	"issuer_id" integer,
	"isin" text,
	"headline" text NOT NULL,
	"news_type" text,
	"published_at" timestamp with time zone NOT NULL,
	"published_date" date NOT NULL,
	"natural_key_hash" text NOT NULL,
	"raw" jsonb,
	CONSTRAINT "news_item_natural_key_hash_unique" UNIQUE("natural_key_hash")
);
--> statement-breakpoint
ALTER TABLE "news_item" ADD CONSTRAINT "news_item_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_item" ADD CONSTRAINT "news_item_issuer_id_issuer_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."issuer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "news_item_issuer_idx" ON "news_item" USING btree ("issuer_id","published_date");--> statement-breakpoint
CREATE INDEX "news_item_published_idx" ON "news_item" USING btree ("published_date");--> statement-breakpoint
CREATE INDEX "news_item_source_external_idx" ON "news_item" USING btree ("source","external_id");