CREATE TABLE "access_history" (
	"chain_id" integer NOT NULL,
	"type" varchar(20) NOT NULL,
	"identifier" varchar(66) NOT NULL,
	"first_accessed" "TIMESTAMP_MS" DEFAULT now(),
	"last_accessed" "TIMESTAMP_MS" DEFAULT now(),
	"access_count" integer DEFAULT 1,
	CONSTRAINT "access_history_chain_id_type_identifier_pk" PRIMARY KEY("chain_id","type","identifier")
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"chain_id" integer NOT NULL,
	"number" "BIGNUM" NOT NULL,
	"hash" char(66) NOT NULL,
	"parent_hash" char(66),
	"timestamp" "TIMESTAMP_S",
	"miner" char(42),
	"gas_limit" "BIGNUM",
	"gas_used" "BIGNUM",
	"base_fee_per_gas" "BIGNUM",
	"transaction_count" integer,
	"size_bytes" integer,
	"difficulty" "BIGNUM",
	"total_difficulty" "BIGNUM",
	"extra_data" text,
	"logs_bloom" text,
	"state_root" char(66),
	"transactions_root" char(66),
	"receipts_root" char(66),
	"indexed_at" "TIMESTAMP_MS" DEFAULT now(),
	CONSTRAINT "blocks_chain_id_number_pk" PRIMARY KEY("chain_id","number"),
	CONSTRAINT "blocks_chainId_hash_unique" UNIQUE("chain_id","hash")
);
--> statement-breakpoint
CREATE TABLE "contract_creation_info" (
	"chain_id" integer NOT NULL,
	"address" char(42) NOT NULL,
	"creation_tx_hash" char(66),
	"creation_block_number" "BIGNUM",
	"creator_address" char(42),
	"factory_address" char(42),
	"creation_method" varchar(50),
	"last_updated" "TIMESTAMP_MS" DEFAULT now(),
	CONSTRAINT "contract_creation_info_chain_id_address_pk" PRIMARY KEY("chain_id","address")
);
--> statement-breakpoint
CREATE TABLE "contract_sources" (
	"chain_id" integer NOT NULL,
	"address" char(42) NOT NULL,
	"source_code" text,
	"abi" text,
	"contract_name" varchar(255),
	"compiler_version" varchar(50),
	"optimization_used" boolean,
	"runs" integer,
	"constructor_arguments" text,
	"evm_version" varchar(50),
	"library" text,
	"license_type" varchar(50),
	"proxy" varchar(50),
	"implementation" char(42),
	"swarm_source" varchar(100),
	"is_verified" boolean DEFAULT false,
	"verification_date" "TIMESTAMP_MS" DEFAULT now(),
	"last_updated" "TIMESTAMP_MS" DEFAULT now(),
	CONSTRAINT "contract_sources_chain_id_address_pk" PRIMARY KEY("chain_id","address")
);
--> statement-breakpoint
CREATE TABLE "index_status" (
	"chain_id" integer NOT NULL,
	"index_type" varchar(20) NOT NULL,
	"last_indexed_block" "BIGNUM",
	"last_indexed_at" "TIMESTAMP_MS" DEFAULT now(),
	CONSTRAINT "index_status_chain_id_index_type_pk" PRIMARY KEY("chain_id","index_type")
);
--> statement-breakpoint
CREATE TABLE "indexed_addresses" (
	"chain_id" integer NOT NULL,
	"address" char(42) NOT NULL,
	"type" varchar(20) NOT NULL,
	"first_seen" "TIMESTAMP_S",
	"last_activity" "TIMESTAMP_S",
	"transaction_count" integer DEFAULT 0,
	"indexed_at" "TIMESTAMP_MS" DEFAULT now(),
	CONSTRAINT "indexed_addresses_chain_id_address_pk" PRIMARY KEY("chain_id","address")
);
--> statement-breakpoint
CREATE TABLE "search_history" (
	"id" integer PRIMARY KEY NOT NULL,
	"query" varchar(255),
	"search_type" varchar(20),
	"result_count" integer DEFAULT 0,
	"searched_at" "TIMESTAMP_MS" DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"chain_id" integer NOT NULL,
	"hash" char(66) NOT NULL,
	"block_number" "BIGNUM",
	"transaction_index" integer,
	"from_address" char(42),
	"to_address" char(42),
	"value" "BIGNUM",
	"gas_limit" "BIGNUM",
	"gas_price" "BIGNUM",
	"max_fee_per_gas" "BIGNUM",
	"max_priority_fee_per_gas" "BIGNUM",
	"gas_used" "BIGNUM",
	"effective_gas_price" "BIGNUM",
	"status" integer,
	"type" integer DEFAULT 0,
	"nonce" "BIGNUM",
	"input_data" text,
	"logs_count" integer DEFAULT 0,
	"contract_address" char(42),
	"cumulative_gas_used" "BIGNUM",
	"timestamp" "TIMESTAMP_S",
	"indexed_at" "TIMESTAMP_MS" DEFAULT now(),
	CONSTRAINT "transactions_chain_id_hash_pk" PRIMARY KEY("chain_id","hash"),
	CONSTRAINT "transactions_chainId_blockNumber_transactionIndex_unique" UNIQUE("chain_id","block_number","transaction_index")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" integer PRIMARY KEY NOT NULL,
	"theme" varchar(20) DEFAULT 'light',
	"language" varchar(10) DEFAULT 'en',
	"updated_at" "TIMESTAMP_MS" DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_rpc_configs" (
	"chain_id" integer PRIMARY KEY NOT NULL,
	"name" varchar(255),
	"url" varchar(500),
	"supports_history" boolean,
	"max_event_range" integer,
	"created_at" "TIMESTAMP_MS" DEFAULT now(),
	"updated_at" "TIMESTAMP_MS" DEFAULT now()
);
