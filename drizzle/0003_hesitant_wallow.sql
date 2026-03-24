CREATE TABLE "storage_layouts" (
	"chain_id" integer NOT NULL,
	"address" char(42) NOT NULL,
	"layout" text NOT NULL,
	"source" varchar(20),
	"is_proxy" boolean DEFAULT false,
	"implementation_address" char(42),
	"created_at" "TIMESTAMP_MS" DEFAULT now(),
	"updated_at" "TIMESTAMP_MS" DEFAULT now(),
	CONSTRAINT "storage_layouts_chain_id_address_pk" PRIMARY KEY("chain_id","address")
);
