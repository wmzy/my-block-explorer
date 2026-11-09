# Database Layer

DuckDB with custom PostgreSQL adapter for Drizzle ORM.

## STRUCTURE

```
database/
├── duckdb-postgres-adapter.ts  # 484-line PostgreSQL→DuckDB bridge
├── schema.ts                   # Drizzle schema (12+ tables)
├── drizzle.ts                  # Drizzle config entry
├── db-types.ts                 # Custom types (bignum, timestamp, address)
├── dbPath.ts                   # Pure DATABASE_URL → main-db-path parse
├── migrate.ts                  # Migration script
├── seedBuiltinLabels.ts        # Bundled address-label seeds
└── init.ts                     # Re-exports
```

## WHERE TO LOOK

| Task                 | File                         | Key Export                  |
| -------------------- | ---------------------------- | --------------------------- |
| Create DB connection | duckdb-postgres-adapter.ts   | `createDuckDBAdapter()`     |
| Add table schema     | schema.ts                    | `duckdbTable()`             |
| Run migrations       | migrate.ts                   | `runMigrations()`           |

## KEY TYPES

```typescript
// Custom types for DuckDB compatibility
bignum; // BIGINT → VARCHAR(32), prevents precision loss
timestamp; // TIMESTAMP_S (seconds, no timezone)
address; // char(42) for EVM addresses
txHash; // char(66) for transaction hashes
datetime; // TIMESTAMP_MS (milliseconds)
```

## TABLES

| Table               | Primary Key                 | Purpose              |
| ------------------- | --------------------------- | -------------------- |
| `blocks`            | chainId + number            | Block data           |
| `transactions`      | chainId + hash              | Transaction data     |
| `contract_events`   | chainId + txHash + logIndex | Indexed events       |
| `indexing_progress` | chainId + address           | Event indexing state |
| `contract_sources`  | chainId + address           | Contract source/ABI  |
| `user_rpc_configs`  | chainId                     | Custom RPC settings  |

## NOTES

- No SERIAL type (DuckDB incompatible) — use composite primary keys
- Adapter implements `postgres` package interface for Drizzle compatibility
- Schema self-initialization in adapter `ensureTables()`
- Drizzle config uses `dialect: "postgresql"` with `casing: "snake_case"`
- One main database (data/blockchain.db, path from dbPath.ts); the former
  per-chain `data/chains/{type}/{name}-{id}.db` subsystem
  (chain-database-manager/chain-schema/chain-drizzle + config/zero-config)
  was dead code — every service writes to the main DB — and was removed in
  the 2026-11-09 cleanup wave. `data/chains/` only ever appears at runtime
  as a directory the uninstall/ops surfaces enumerate on disk.
