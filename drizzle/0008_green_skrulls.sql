CREATE TABLE "short_position_snapshot" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"rows" jsonb NOT NULL,
	"diagnostics" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "short_position_snapshot_captured_idx" ON "short_position_snapshot" USING btree ("captured_at");