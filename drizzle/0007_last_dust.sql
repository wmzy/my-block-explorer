CREATE TABLE "signature_cache" (
	"kind" varchar(10) NOT NULL,
	"selector" varchar(66) NOT NULL,
	"signature" text,
	"source" varchar(20),
	"fetched_at" "TIMESTAMP_MS" DEFAULT now(),
	CONSTRAINT "signature_cache_kind_selector_pk" PRIMARY KEY("kind","selector")
);
--> statement-breakpoint
-- NOTE: implementation_addresses is intentionally NOT here. Migration 0006
-- (hand-written, no meta snapshot) already added the column; the first
-- generate after it diffed against the stale 0005 snapshot and re-emitted
-- the ALTER here, which double-applied on fresh databases. The 0007 meta
-- snapshot below reflects the full schema, so future generates are clean.