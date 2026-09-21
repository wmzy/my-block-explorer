CREATE TABLE "address_labels" (
	"chain_id" integer NOT NULL,
	"address" char(42) NOT NULL,
	"label" varchar(64) NOT NULL,
	"note" text,
	"created_at" "TIMESTAMP_MS" DEFAULT now(),
	"updated_at" "TIMESTAMP_MS" DEFAULT now(),
	CONSTRAINT "address_labels_chain_id_address_pk" PRIMARY KEY("chain_id","address")
);
