CREATE TYPE "public"."fundamental_source" AS ENUM('boerse_frankfurt', 'esef');--> statement-breakpoint
CREATE TYPE "public"."market_index" AS ENUM('DAX', 'MDAX', 'SDAX');--> statement-breakpoint
CREATE TYPE "public"."party_role" AS ENUM('executive_board', 'supervisory_board', 'related_party', 'other');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'success', 'error');--> statement-breakpoint
CREATE TYPE "public"."transaction_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TABLE "eod_price" (
	"instrument_id" integer NOT NULL,
	"trade_date" date NOT NULL,
	"open" numeric,
	"high" numeric,
	"low" numeric,
	"close" numeric NOT NULL,
	"volume" bigint,
	"currency" text,
	"source" text DEFAULT 'boerse_frankfurt' NOT NULL,
	CONSTRAINT "eod_price_instrument_id_trade_date_pk" PRIMARY KEY("instrument_id","trade_date")
);
--> statement-breakpoint
CREATE TABLE "fundamental" (
	"id" serial PRIMARY KEY NOT NULL,
	"issuer_id" integer NOT NULL,
	"metric" text NOT NULL,
	"value" numeric NOT NULL,
	"currency" text,
	"period_type" text DEFAULT 'LATEST' NOT NULL,
	"period_end" date NOT NULL,
	"published_date" date NOT NULL,
	"source" "fundamental_source" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_membership" (
	"id" serial PRIMARY KEY NOT NULL,
	"instrument_id" integer NOT NULL,
	"index_name" "market_index" NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date
);
--> statement-breakpoint
CREATE TABLE "ingestion_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"job" text NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"cursor" jsonb,
	"stats" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "insider_transaction" (
	"id" serial PRIMARY KEY NOT NULL,
	"issuer_id" integer,
	"isin" text,
	"issuer_name_raw" text NOT NULL,
	"party_name" text,
	"party_role" "party_role" DEFAULT 'other' NOT NULL,
	"side" "transaction_side" NOT NULL,
	"price" numeric,
	"volume" numeric,
	"amount" numeric,
	"currency" text,
	"transaction_date" date NOT NULL,
	"published_date" date NOT NULL,
	"venue" text,
	"natural_key_hash" text NOT NULL,
	"raw" jsonb,
	CONSTRAINT "insider_transaction_natural_key_hash_unique" UNIQUE("natural_key_hash")
);
--> statement-breakpoint
CREATE TABLE "instrument" (
	"id" serial PRIMARY KEY NOT NULL,
	"issuer_id" integer NOT NULL,
	"isin" text NOT NULL,
	"wkn" text,
	"ticker" text,
	"market" text DEFAULT 'XETR' NOT NULL,
	"currency" text,
	"first_seen" date NOT NULL,
	"last_seen" date NOT NULL,
	CONSTRAINT "instrument_isin_unique" UNIQUE("isin")
);
--> statement-breakpoint
CREATE TABLE "issuer" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"lei" text,
	"sector" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screen" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"params" jsonb,
	CONSTRAINT "screen_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "signal" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"screen_id" integer NOT NULL,
	"instrument_id" integer NOT NULL,
	"passed_gate" boolean NOT NULL,
	"score" numeric,
	"percentile" numeric,
	"rank" integer,
	"rationale" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_date" date NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"universe_size" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "signal_run_run_date_unique" UNIQUE("run_date")
);
--> statement-breakpoint
ALTER TABLE "eod_price" ADD CONSTRAINT "eod_price_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundamental" ADD CONSTRAINT "fundamental_issuer_id_issuer_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."issuer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_membership" ADD CONSTRAINT "index_membership_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insider_transaction" ADD CONSTRAINT "insider_transaction_issuer_id_issuer_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."issuer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument" ADD CONSTRAINT "instrument_issuer_id_issuer_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."issuer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal" ADD CONSTRAINT "signal_run_id_signal_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."signal_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal" ADD CONSTRAINT "signal_screen_id_screen_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal" ADD CONSTRAINT "signal_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fundamental_natural_key_idx" ON "fundamental" USING btree ("issuer_id","metric","period_end","source");--> statement-breakpoint
CREATE INDEX "index_membership_instrument_idx" ON "index_membership" USING btree ("instrument_id","index_name");--> statement-breakpoint
CREATE INDEX "ingestion_run_job_idx" ON "ingestion_run" USING btree ("job","started_at");--> statement-breakpoint
CREATE INDEX "insider_issuer_idx" ON "insider_transaction" USING btree ("issuer_id","transaction_date");--> statement-breakpoint
CREATE INDEX "insider_published_idx" ON "insider_transaction" USING btree ("published_date");--> statement-breakpoint
CREATE INDEX "instrument_issuer_idx" ON "instrument" USING btree ("issuer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issuer_lei_idx" ON "issuer" USING btree ("lei");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_natural_key_idx" ON "signal" USING btree ("run_id","screen_id","instrument_id");