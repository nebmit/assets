ALTER TYPE "public"."fundamental_source" ADD VALUE 'sec';--> statement-breakpoint
CREATE TABLE "source_filing" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"issuer_id" integer,
	"form" text NOT NULL,
	"filed_date" date NOT NULL,
	"report_date" date,
	"accepted_at" timestamp with time zone,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"url" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "fundamental_natural_key_idx";--> statement-breakpoint
ALTER TABLE "fundamental" ADD COLUMN "period_start" date;--> statement-breakpoint
ALTER TABLE "fundamental" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "fundamental" ADD COLUMN "reporting_basis" text;--> statement-breakpoint
ALTER TABLE "fundamental" ADD COLUMN "source_record_id" text;--> statement-breakpoint
ALTER TABLE "fundamental" ADD COLUMN "filing_id" integer;--> statement-breakpoint
ALTER TABLE "fundamental" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fundamental" ADD COLUMN "observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fundamental" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "fundamental" ADD COLUMN "eligible_for_product" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "insider_transaction" ADD COLUMN "source" text DEFAULT 'bafin' NOT NULL;--> statement-breakpoint
ALTER TABLE "insider_transaction" ADD COLUMN "source_record_id" text;--> statement-breakpoint
ALTER TABLE "insider_transaction" ADD COLUMN "filing_id" integer;--> statement-breakpoint
ALTER TABLE "insider_transaction" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "insider_transaction" ADD COLUMN "observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "insider_transaction" ADD COLUMN "amendment_status" text;--> statement-breakpoint
ALTER TABLE "insider_transaction" ADD COLUMN "eligible_for_product" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "issuer" ADD COLUMN "cik" text;--> statement-breakpoint
ALTER TABLE "issuer" ADD COLUMN "sec_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "news_item" ADD COLUMN "filing_id" integer;--> statement-breakpoint
ALTER TABLE "news_item" ADD COLUMN "eligible_for_product" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "source_filing" ADD CONSTRAINT "source_filing_issuer_id_issuer_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."issuer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_filing_external_idx" ON "source_filing" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "source_filing_work_idx" ON "source_filing" USING btree ("source","status");--> statement-breakpoint
CREATE INDEX "source_filing_issuer_idx" ON "source_filing" USING btree ("issuer_id","filed_date");--> statement-breakpoint
ALTER TABLE "fundamental" ADD CONSTRAINT "fundamental_filing_id_source_filing_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."source_filing"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insider_transaction" ADD CONSTRAINT "insider_transaction_filing_id_source_filing_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."source_filing"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_item" ADD CONSTRAINT "news_item_filing_id_source_filing_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."source_filing"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fundamental_source_record_idx" ON "fundamental" USING btree ("source","source_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fundamental_natural_key_idx" ON "fundamental" USING btree ("issuer_id","metric","period_end","source") WHERE "fundamental"."source" in ('boerse_frankfurt', 'esef');--> statement-breakpoint
ALTER TABLE "issuer" ADD CONSTRAINT "issuer_cik_unique" UNIQUE("cik");