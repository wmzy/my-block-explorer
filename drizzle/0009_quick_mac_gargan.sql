CREATE TABLE "custom_chains" (
	"chain_id" integer PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"symbol" varchar(64) NOT NULL,
	"rpc_url" varchar(500) NOT NULL,
	"decimals" integer DEFAULT 18,
	"created_at" "TIMESTAMP_MS" DEFAULT now(),
	"updated_at" "TIMESTAMP_MS" DEFAULT now()
);
