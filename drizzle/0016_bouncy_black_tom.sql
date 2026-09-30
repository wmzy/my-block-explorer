CREATE TABLE "provider_limits" (
	"chain_id" integer PRIMARY KEY NOT NULL,
	"max_log_span" "BIGNUM" NOT NULL,
	"updated_at" "TIMESTAMP_MS" DEFAULT now()
);
