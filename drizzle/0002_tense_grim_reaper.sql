CREATE TABLE "indexing_ranges" (
	"chain_id" integer NOT NULL,
	"address" char(42) NOT NULL,
	"range_id" integer NOT NULL,
	"from_block" "BIGNUM" NOT NULL,
	"to_block" "BIGNUM" NOT NULL,
	"direction" varchar(10) DEFAULT 'forward' NOT NULL,
	"current_block" "BIGNUM",
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"total_events_indexed" integer DEFAULT 0,
	"error_message" text,
	"priority" integer DEFAULT 0,
	"created_at" "TIMESTAMP_MS" DEFAULT now(),
	"updated_at" "TIMESTAMP_MS" DEFAULT now(),
	CONSTRAINT "indexing_ranges_chain_id_address_range_id_pk" PRIMARY KEY("chain_id","address","range_id")
);
