CREATE TABLE "address_scan_internal_txs" (
	"chain_id" integer NOT NULL,
	"address" varchar(42) NOT NULL,
	"tx_hash" char(66) NOT NULL,
	"trace_path" varchar NOT NULL,
	"block_number" "BIGNUM" NOT NULL,
	"transaction_index" integer NOT NULL,
	"from_address" char(42) NOT NULL,
	"to_address" char(42) NOT NULL,
	"value" "BIGNUM" NOT NULL,
	"call_type" varchar(20) NOT NULL,
	"reverted" boolean NOT NULL,
	"block_timestamp" "TIMESTAMP_MS" NOT NULL,
	CONSTRAINT "address_scan_internal_txs_chain_id_address_tx_hash_trace_path_pk" PRIMARY KEY("chain_id","address","tx_hash","trace_path")
);
--> statement-breakpoint
ALTER TABLE "address_scan_jobs" ADD COLUMN "traces_requested" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "address_scan_jobs" ADD COLUMN "traces_supported" boolean;--> statement-breakpoint
ALTER TABLE "address_scan_jobs" ADD COLUMN "traces_recorded" integer DEFAULT 0;