CREATE TABLE "watch_subscriptions" (
	"chain_id" integer NOT NULL,
	"address" varchar(42) NOT NULL,
	"label" varchar(100),
	"last_processed_block" "BIGNUM",
	"created_at" "TIMESTAMP_MS" DEFAULT now(),
	"updated_at" "TIMESTAMP_MS" DEFAULT now(),
	CONSTRAINT "watch_subscriptions_chain_id_address_pk" PRIMARY KEY("chain_id","address")
);
