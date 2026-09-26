# ADR-0004: DuckDB behind a custom PostgreSQL adapter for Drizzle

- Status: Accepted
- Date: 2026-09-26

## Context

We wanted Drizzle ORM ergonomics over DuckDB's embedded analytics storage;
no official Drizzle DuckDB driver exists. AGENTS.md → "Custom
DuckDB-PostgreSQL Adapter" and "Per-Chain Event Databases" describe the
shipped design (`src/database/duckdb-postgres-adapter.ts` implements the
`postgres` package interface so Drizzle can drive DuckDB). Hard lessons that
shaped the rules below: TIMESTAMP_MS columns come back as
`{millis}` value objects (not `{micros}`), DuckDB's `now()` writes local
wall time under a non-UTC session, hand-written migrations without a meta
snapshot get double-generated, and DuckDB rejects `ADD COLUMN NOT NULL`
(AGENTS.md → 2026-09-22/23 and 2026-09-23/24 wave notes).

## Decision

- Keep DuckDB (`@duckdb/node-api`) behind the custom adapter; all schema
  access goes through Drizzle (`src/database/schema.ts`).
- **No SERIAL** — DuckDB-incompatible; use composite primary keys.
- Timestamps: the adapter's `adaptResult` normalizes micros/millis/seconds
  value objects and strict-shape naive datetime strings to correctly-parsed
  `Date`s; `openSession()` pins every connection's session TZ to UTC; naive
  strings (no offset/Z) parse as UTC — reference implementation
  `toIsoTimestamp` in `src/services/SearchService.ts`; never bare
  `new Date(str)`.
- Events live in **per-chain DuckDB files** (`data/chains/{type}/{name}-{id}.db`,
  managed by `ChainSchemaManager`); shared tables live in the main DB.
- Hand-written migrations MUST add a meta snapshot or the next
  `pnpm db:generate` re-emits their diff (drizzle-kit diffs against the last
  snapshot, not the database).
- Nullable `ADD COLUMN` + default instead of `ADD COLUMN NOT NULL`.

## Consequences

- **Single writer per file** is a runtime invariant: never two server
  processes on the same DB (dev topology warning in CONTRIBUTING.md); tests
  mock `@/database/init` instead of opening real files.
- The adapter is a maintained seam — new Drizzle/DuckDB features need
  adapter-level verification, and adapter bugs masquerade as binding errors
  (`adaptError` wraps conversion failures).
- Historical dev-DB rows written by the old local-time `now()` may read
  TZ-shifted; fresh writes are exact.
