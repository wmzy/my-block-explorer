CREATE TABLE "address_scan_findings" (
	"chain_id" integer NOT NULL,
	"address" varchar(42) NOT NULL,
	"tx_hash" char(66) NOT NULL,
	"block_number" "BIGNUM" NOT NULL,
	CONSTRAINT "address_scan_findings_chain_id_address_tx_hash_pk" PRIMARY KEY("chain_id","address","tx_hash")
);
--> statement-breakpoint
CREATE TABLE "address_scan_jobs" (
	"chain_id" integer NOT NULL,
	"address" varchar(42) NOT NULL,
	"from_block" "BIGNUM" NOT NULL,
	"to_block" "BIGNUM" NOT NULL,
	"cursor_block" "BIGNUM" NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"txs_found" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"updated_at" "TIMESTAMP_MS" DEFAULT now() NOT NULL,
	CONSTRAINT "address_scan_jobs_chain_id_address_pk" PRIMARY KEY("chain_id","address")
);
