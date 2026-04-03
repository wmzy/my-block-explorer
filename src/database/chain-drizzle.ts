import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDuckDBAdapter } from './duckdb-postgres-adapter';
import * as chainSchema from './chain-schema';

export function createChainDrizzleFromAdapter(
  adapter: ReturnType<typeof createDuckDBAdapter>,
): PostgresJsDatabase<typeof chainSchema> {
  return drizzle(adapter, { schema: chainSchema, casing: 'snake_case' });
}
