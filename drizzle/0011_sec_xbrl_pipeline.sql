CREATE TABLE "sec_extraction" (
	"id" serial PRIMARY KEY NOT NULL,
	"filing_id" integer NOT NULL,
	"package_hash" text NOT NULL,
	"parser_version" text NOT NULL,
	"config_hash" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"artifact" jsonb NOT NULL,
	"diagnostics" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sec_processing" (
	"config_hash" text NOT NULL,
	"filing_id" integer NOT NULL,
	"input_hash" text NOT NULL,
	"parser_version" text NOT NULL,
	"resolver_version" integer NOT NULL,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	"reason_code" text,
	"error" text,
	"extraction_id" integer,
	"manifest" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sec_processing_filing_id_input_hash_parser_version_resolver_version_config_hash_pk" PRIMARY KEY("filing_id","input_hash","parser_version","resolver_version","config_hash")
);
--> statement-breakpoint
ALTER TABLE "signal_run" DROP CONSTRAINT "signal_run_run_date_unique";--> statement-breakpoint
ALTER TABLE "signal_run" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sec_extraction" ADD CONSTRAINT "sec_extraction_filing_id_source_filing_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."source_filing"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_processing" ADD CONSTRAINT "sec_processing_filing_id_source_filing_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."source_filing"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_processing" ADD CONSTRAINT "sec_processing_extraction_id_sec_extraction_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."sec_extraction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sec_extraction_identity" ON "sec_extraction" USING btree ("filing_id","package_hash","parser_version","config_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_run_current_date" ON "signal_run" USING btree ("run_date") WHERE "signal_run"."is_current" = true;