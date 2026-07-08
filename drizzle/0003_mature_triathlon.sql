CREATE TABLE "user_blob" (
	"user_uuid" text NOT NULL,
	"name" text NOT NULL,
	"ciphertext" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blob_user_uuid_name_pk" PRIMARY KEY("user_uuid","name")
);
--> statement-breakpoint
CREATE TABLE "user_key_wrap" (
	"user_uuid" text NOT NULL,
	"credential_id" text NOT NULL,
	"purpose" text NOT NULL,
	"wrapped_dek" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_key_wrap_user_uuid_purpose_credential_id_pk" PRIMARY KEY("user_uuid","purpose","credential_id")
);
