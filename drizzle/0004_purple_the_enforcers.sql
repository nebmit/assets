CREATE TABLE "user_ignored_asset" (
	"user_uuid" text NOT NULL,
	"isin" text NOT NULL,
	"name" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_ignored_asset_user_uuid_isin_pk" PRIMARY KEY("user_uuid","isin")
);
