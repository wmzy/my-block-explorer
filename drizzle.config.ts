import type { Config } from 'drizzle-kit';

// Schema-generation config only: `pnpm db:generate` diffs this schema
// against the snapshot in ./drizzle and writes migration files. Drizzle Kit
// cannot connect to DuckDB (the adapter in src/database/ is the bridge the
// app uses, Kit is not), and migrations are APPLIED at server boot by the
// adapter's own runner (`duckdb-postgres-adapter.ts` `migrate()`), never by
// `drizzle-kit migrate` — the official migrator writes journal rows the
// runtime runner cannot match.
export default {
  schema: './src/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql', // PostgreSQL syntax — the adapter maps it onto DuckDB
  casing: 'snake_case',
  verbose: true,
  strict: true,
} satisfies Config;
