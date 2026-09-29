// Pure DATABASE_URL → main-db-path resolution, shared by OpsService (ops
// dashboard) and the uninstall CLI. Kept free of imports so the uninstall
// path never pulls the database adapter graph — the adapter's constructor
// mkdirs data/, which would fabricate the very thing uninstall measures.

/**
 * The main database file path from DATABASE_URL, mirroring the adapter's
 * own parseConnectionString (src/database/duckdb-postgres-adapter.ts):
 * strip the duckdb:// scheme, fall back to the default relative path for
 * anything else (including unset).
 */
export function parseMainDbPath(databaseUrl: string | undefined): string {
  if (databaseUrl?.startsWith('duckdb://')) {
    return databaseUrl.slice('duckdb://'.length);
  }
  return 'data/blockchain.db';
}
