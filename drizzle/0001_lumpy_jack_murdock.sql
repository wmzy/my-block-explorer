CREATE TABLE "contract_events" (
	"chain_id" integer NOT NULL,
	"contract_address" char(42) NOT NULL,
	"block_number" "BIGNUM" NOT NULL,
	"block_timestamp" "TIMESTAMP_S",
	"transaction_hash" char(66) NOT NULL,
	"transaction_index" integer,
	"log_index" integer NOT NULL,
	"event_name" varchar(100),
	"event_signature" varchar(66),
	"decoded_args" text,
	"topic0" varchar(66),
	"topic1" varchar(66),
	"topic2" varchar(66),
	"topic3" varchar(66),
	"data" text,
	"is_finalized" boolean DEFAULT false,
	"indexed_at" "TIMESTAMP_MS" DEFAULT now(),
	CONSTRAINT "contract_events_chain_id_transaction_hash_log_index_pk" PRIMARY KEY("chain_id","transaction_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "event_table_registry" (
	"chain_id" integer NOT NULL,
	"address" char(42) NOT NULL,
	"contract_address" char(42) NOT NULL,
	"event_signature" varchar(66) NOT NULL,
	"event_name" varchar(255),
	"table_name" varchar(255) NOT NULL,
	"table_schema" text,
	"is_active" boolean DEFAULT true,
	"last_accessed" "TIMESTAMP_MS",
	"created_at" "TIMESTAMP_MS" DEFAULT now(),
	"updated_at" "TIMESTAMP_MS" DEFAULT now(),
	CONSTRAINT "event_table_registry_chain_id_contract_address_event_signature_pk" PRIMARY KEY("chain_id","contract_address","event_signature")
);
--> statement-breakpoint
CREATE TABLE "indexing_progress" (
	"chain_id" integer NOT NULL,
	"address" char(42) NOT NULL,
	"creation_block" "BIGNUM",
	"last_indexed_block" "BIGNUM",
	"last_finalized_block" "BIGNUM",
	"total_events_indexed" integer DEFAULT 0,
	"status" varchar(20) DEFAULT 'idle',
	"error_message" text,
	"updated_at" "TIMESTAMP_MS" DEFAULT now(),
	CONSTRAINT "indexing_progress_chain_id_address_pk" PRIMARY KEY("chain_id","address")
);
--> statement-breakpoint
ALTER TABLE "contract_creation_info" ADD COLUMN "creation_timestamp" "TIMESTAMP_S";--> statement-breakpoint
ALTER TABLE "search_history" ADD COLUMN "chain_id" integer;