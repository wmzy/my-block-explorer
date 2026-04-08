# Database Layer

DuckDB with custom PostgreSQL adapter for Drizzle ORM.

## STRUCTURE

```
database/
├── duckdb-postgres-adapter.ts  # 484-line PostgreSQL→DuckDB bridge
├── schema.ts                   # Drizzle schema (12+ tables)
├── drizzle.ts                  # Drizzle config entry
├── duckdb.ts                   # DuckDB manager wrapper
├── db-types.ts                 # Custom types (bignum, timestamp, address)
├── chain-database-manager.ts   # Per-chain DB file management
├── chain-schema-manager.ts     # Dynamic event table schemas via drizzle-kit/api
├── chain-event-table-manager.ts # Dynamic event table creation (923 lines)
├── multi-chain-setup.ts        # Environment presets
├── performance-monitor.ts      # Query performance tracking
├── migrate.ts                  # Migration script
└── init.ts                     # Re-exports
```

## WHERE TO LOOK

| Task                 | File                         | Key Export                  |
| -------------------- | ---------------------------- | --------------------------- |
| Create DB connection | duckdb-postgres-adapter.ts   | `createDuckDBAdapter()`     |
| Add table schema     | schema.ts                    | `duckdbTable()`             |
| Get per-chain DB     | chain-database-manager.ts    | `MultiChainDatabaseManager` |
| Create event table   | chain-event-table-manager.ts | `createEventTable()`        |
| Dynamic table SQL    | chain-schema-manager.ts      | `ChainSchemaManager`        |
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

## PER-CHAIN DATABASES

```
data/chains/{type}/{name}-{id}.db
├── mainnet/ethereum-1.db
├── mainnet/polygon-137.db
└── testnet/sepolia-11155111.db
```

## NOTES

- No SERIAL type (DuckDB incompatible) — use composite primary keys
- Adapter implements `postgres` package interface for Drizzle compatibility
- Schema self-initialization in adapter `ensureTables()`
- Drizzle config uses `dialect: "postgresql"` with `casing: "snake_case"`
