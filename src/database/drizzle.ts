import { drizzle } from 'drizzle-orm/postgres-js';
import { createDuckDBAdapter } from './duckdb-postgres-adapter';
import * as schema from './schema';

const GLOBAL_KEY = '__my_block_explorer_duckdb_adapter__';
const MODULE_KEY = '__my_block_explorer_module_hash__';
const CURRENT_HASH = 'v2-wal-recovery';

const needsReset = (globalThis as any)[MODULE_KEY] !== CURRENT_HASH;

if (needsReset) {
  delete (globalThis as any)[GLOBAL_KEY];
  (globalThis as any)[MODULE_KEY] = CURRENT_HASH;
}

const duckdbAdapter =
  (globalThis as any)[GLOBAL_KEY] ??
  createDuckDBAdapter(process.env.DATABASE_URL ?? 'duckdb://data/blockchain.db');

if (!(globalThis as any)[GLOBAL_KEY]) {
  (globalThis as any)[GLOBAL_KEY] = duckdbAdapter;
}

export const db = drizzle(duckdbAdapter, {
  schema,
  casing: 'snake_case',
});

export * from './schema';
