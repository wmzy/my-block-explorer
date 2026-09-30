import { drizzle } from 'drizzle-orm/postgres-js';
import { createDuckDBAdapter } from './duckdb-postgres-adapter';
import * as schema from './schema';

const GLOBAL_KEY = '__my_block_explorer_duckdb_adapter__';
const MODULE_KEY = '__my_block_explorer_module_hash__';
const CURRENT_HASH = 'v2-wal-recovery';

// Cross-reload singleton registry (vitest re-imports this module with a new
// hash; the adapter must not be rebuilt under a live DuckDB handle).
type AdapterRegistry = typeof globalThis & {
  [GLOBAL_KEY]?: ReturnType<typeof createDuckDBAdapter>;
  [MODULE_KEY]?: string;
};
const registry = globalThis as AdapterRegistry;

const needsReset = registry[MODULE_KEY] !== CURRENT_HASH;

if (needsReset) {
  delete registry[GLOBAL_KEY];
  registry[MODULE_KEY] = CURRENT_HASH;
}

const duckdbAdapter =
  registry[GLOBAL_KEY] ??
  createDuckDBAdapter(process.env.DATABASE_URL ?? 'duckdb://data/blockchain.db');

registry[GLOBAL_KEY] ??= duckdbAdapter;

export const db = drizzle(duckdbAdapter, {
  schema,
  casing: 'snake_case',
});

export * from './schema';
