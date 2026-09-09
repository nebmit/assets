ALTER TABLE instrument ADD COLUMN asset_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE instrument ADD CONSTRAINT instrument_asset_id_unique UNIQUE(asset_id);
ALTER TABLE instrument ALTER COLUMN isin DROP NOT NULL;
ALTER TABLE instrument ADD COLUMN security_class text;
ALTER TABLE instrument ADD COLUMN short_disclosure_source text;
UPDATE instrument SET short_disclosure_source='bundesanzeiger' WHERE market='XETR';
ALTER TABLE signal_run ADD COLUMN cutoff_at timestamptz;
ALTER TABLE signal_run ADD COLUMN definition_versions jsonb;

--> statement-breakpoint
CREATE TABLE "asset_snapshot" (
	"run_id" integer NOT NULL,
	"instrument_id" integer NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "asset_snapshot_run_id_instrument_id_pk" PRIMARY KEY("run_id","instrument_id")
);

--> statement-breakpoint
CREATE TABLE "corporate_action" (
	"id" serial PRIMARY KEY NOT NULL,
	"instrument_id" integer NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"type" text NOT NULL,
	"ex_date" date NOT NULL,
	"ratio" numeric,
	"amount" numeric,
	"currency" text,
	"observed_at" timestamp with time zone NOT NULL,
	"source_record_id" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"qualification" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "corporate_action_source_record_id_unique" UNIQUE("source_record_id")
);

--> statement-breakpoint
CREATE TABLE "fx_rate" (
	"date" date NOT NULL,
	"currency" text NOT NULL,
	"units_per_eur" numeric NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"evidence" jsonb NOT NULL,
	CONSTRAINT "fx_rate_date_currency_observed_at_pk" PRIMARY KEY("date","currency","observed_at")
);

--> statement-breakpoint
CREATE TABLE "listing" (
	"id" serial PRIMARY KEY NOT NULL,
	"instrument_id" integer NOT NULL,
	"mic" text NOT NULL,
	"symbol" text,
	"currency" text NOT NULL,
	"source" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"is_primary" boolean DEFAULT true NOT NULL,
	"price_history_covered_from" date,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);

--> statement-breakpoint
CREATE TABLE "provider_identifier" (
	"id" serial PRIMARY KEY NOT NULL,
	"instrument_id" integer NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"evidence" jsonb
);

--> statement-breakpoint
CREATE TABLE "universe" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"size_band" text NOT NULL,
	"source" text NOT NULL,
	"basis" text NOT NULL
);

--> statement-breakpoint
INSERT INTO universe(id,name,size_band,source,basis) VALUES
('DAX','DAX','large','boerse_frankfurt','provider_constituents'),
('MDAX','MDAX','mid','boerse_frankfurt','provider_constituents'),
('SDAX','SDAX','small','boerse_frankfurt','provider_constituents'),
('sp500','S&P 500 (IVV holdings)','large','sec','etf_holdings_proxy'),
('sp400','S&P MidCap 400 (IJH holdings)','mid','sec','etf_holdings_proxy');
INSERT INTO listing(instrument_id,mic,symbol,currency,source,valid_from,price_history_covered_from)
SELECT id,market,ticker,coalesce(currency,'EUR'),'boerse_frankfurt',first_seen,price_history_covered_from FROM instrument;
ALTER TABLE index_membership ALTER COLUMN index_name TYPE text USING index_name::text;
ALTER TABLE index_membership ADD CONSTRAINT index_membership_universe_fk FOREIGN KEY(index_name) REFERENCES universe(id);
ALTER TABLE index_membership ADD COLUMN snapshot_date date;
ALTER TABLE index_membership ADD COLUMN observed_at timestamptz;
ALTER TABLE index_membership ADD COLUMN evidence jsonb;
DROP TYPE market_index;
ALTER TABLE eod_price DROP CONSTRAINT eod_price_instrument_id_trade_date_pk;
ALTER TABLE eod_price ADD COLUMN id serial PRIMARY KEY;
ALTER TABLE eod_price ADD COLUMN listing_id integer;
UPDATE eod_price p SET listing_id=l.id FROM listing l WHERE l.instrument_id=p.instrument_id;
ALTER TABLE eod_price ALTER COLUMN listing_id SET NOT NULL;
ALTER TABLE eod_price ADD CONSTRAINT eod_price_listing_id_listing_id_fk FOREIGN KEY(listing_id) REFERENCES listing(id);
ALTER TABLE eod_price DROP COLUMN instrument_id;
UPDATE eod_price SET currency='EUR' WHERE currency IS NULL;
ALTER TABLE eod_price ALTER COLUMN currency SET NOT NULL;
ALTER TABLE eod_price ALTER COLUMN source DROP DEFAULT;
ALTER TABLE eod_price ADD COLUMN feed text NOT NULL DEFAULT 'XETR';
ALTER TABLE eod_price ALTER COLUMN feed DROP DEFAULT;
ALTER TABLE eod_price ADD COLUMN adjustment text NOT NULL DEFAULT 'raw';
ALTER TABLE eod_price ADD COLUMN source_record_id text;
UPDATE eod_price SET source_record_id='legacy:' || id;
ALTER TABLE eod_price ALTER COLUMN source_record_id SET NOT NULL;
ALTER TABLE eod_price ADD CONSTRAINT eod_price_source_record_id_unique UNIQUE(source_record_id);
ALTER TABLE eod_price ADD COLUMN observed_at timestamptz;
ALTER TABLE eod_price ADD COLUMN evidence jsonb;
CREATE INDEX eod_price_listing_date_idx ON eod_price(listing_id,trade_date);
ALTER TABLE instrument DROP COLUMN ticker;
ALTER TABLE instrument DROP COLUMN market;
ALTER TABLE instrument DROP COLUMN currency;
ALTER TABLE instrument DROP COLUMN price_history_covered_from;
ALTER TABLE fundamental ADD COLUMN instrument_id integer REFERENCES instrument(id);
UPDATE fundamental f SET instrument_id=i.id FROM instrument i WHERE i.issuer_id=f.issuer_id AND f.source='boerse_frankfurt' AND (SELECT count(*) FROM instrument k WHERE k.issuer_id=f.issuer_id)=1;
DROP INDEX fundamental_natural_key_idx;
CREATE INDEX fundamental_lookup_idx ON fundamental(issuer_id,metric,period_end);
ALTER TABLE insider_transaction ADD COLUMN instrument_id integer REFERENCES instrument(id);
ALTER TABLE insider_transaction ADD COLUMN economic_key text;
UPDATE insider_transaction t SET instrument_id=i.id FROM instrument i WHERE t.isin=i.isin;
UPDATE insider_transaction SET economic_key=natural_key_hash WHERE source='bafin';
UPDATE insider_transaction SET instrument_type='common_share' WHERE source='bafin' AND instrument_type='Aktie';
ALTER TABLE news_item ADD COLUMN observed_at timestamptz;
ALTER TABLE user_ignored_asset RENAME COLUMN isin TO asset_id;
UPDATE user_ignored_asset u SET asset_id=i.asset_id::text FROM instrument i WHERE u.asset_id=i.isin;
UPDATE user_ignored_asset SET asset_id='unresolved-isin:' || asset_id WHERE asset_id ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$';
ALTER TABLE user_ignored_asset RENAME CONSTRAINT user_ignored_asset_user_uuid_isin_pk TO user_ignored_asset_user_uuid_asset_id_pk;

--> statement-breakpoint
ALTER TABLE fundamental ADD COLUMN qualification text NOT NULL DEFAULT 'qualified';
ALTER TABLE fundamental ADD COLUMN qualification_reason text;
UPDATE fundamental SET qualification='unqualified',qualification_reason='requires_normalization' WHERE eligible_for_product=false;
ALTER TABLE fundamental DROP COLUMN eligible_for_product;
--> statement-breakpoint
ALTER TABLE insider_transaction ADD COLUMN qualification text NOT NULL DEFAULT 'qualified';
ALTER TABLE insider_transaction ADD COLUMN qualification_reason text;
UPDATE insider_transaction SET qualification='unqualified',qualification_reason='requires_normalization' WHERE eligible_for_product=false;
ALTER TABLE insider_transaction DROP COLUMN eligible_for_product;
--> statement-breakpoint
ALTER TABLE news_item ADD COLUMN qualification text NOT NULL DEFAULT 'qualified';
ALTER TABLE news_item ADD COLUMN qualification_reason text;
UPDATE news_item SET qualification='unqualified',qualification_reason='requires_normalization' WHERE eligible_for_product=false;
ALTER TABLE news_item DROP COLUMN eligible_for_product;
--> statement-breakpoint
ALTER TABLE "asset_snapshot" ADD CONSTRAINT "asset_snapshot_run_id_signal_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."signal_run"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "asset_snapshot" ADD CONSTRAINT "asset_snapshot_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "corporate_action" ADD CONSTRAINT "corporate_action_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "listing" ADD CONSTRAINT "listing_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "provider_identifier" ADD CONSTRAINT "provider_identifier_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "corporate_action_instrument_idx" ON "corporate_action" USING btree ("instrument_id","ex_date");
--> statement-breakpoint
CREATE INDEX "listing_instrument_idx" ON "listing" USING btree ("instrument_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "listing_primary_idx" ON "listing" USING btree ("instrument_id") WHERE "listing"."is_primary" and "listing"."valid_to" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX "listing_symbol_idx" ON "listing" USING btree ("source","mic","symbol") WHERE "listing"."valid_to" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_identifier_active_idx" ON "provider_identifier" USING btree ("source","external_id") WHERE "provider_identifier"."valid_to" is null;

--> statement-breakpoint
ALTER TABLE signal_performance ADD COLUMN currency text;
ALTER TABLE signal_performance ADD COLUMN return_basis text NOT NULL DEFAULT 'legacy_unknown';
ALTER TABLE signal_performance ADD COLUMN source_run_id integer REFERENCES signal_run(id) ON DELETE CASCADE;
