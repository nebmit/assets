CREATE TABLE "signal_performance" (
	"id" serial PRIMARY KEY NOT NULL,
	"signal_id" integer NOT NULL,
	"horizon_days" integer NOT NULL,
	"base_date" date NOT NULL,
	"base_close" numeric NOT NULL,
	"fwd_date" date NOT NULL,
	"fwd_close" numeric NOT NULL,
	"fwd_return" numeric NOT NULL,
	"universe_fwd_return" numeric,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_performance" ADD CONSTRAINT "signal_performance_signal_id_signal_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signal_performance_natural_key_idx" ON "signal_performance" USING btree ("signal_id","horizon_days");