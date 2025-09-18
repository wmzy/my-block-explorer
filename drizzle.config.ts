import type { Config } from "drizzle-kit";

export default {
  schema: "./src/database/schema.ts",
  out: "./src/database/migrations",
  driver: "pg", // 使用 PostgreSQL 驱动（通过适配器）
  dbCredentials: {
    connectionString: "duckdb://data/blockchain.db",
  },
  verbose: true,
  strict: true,
} satisfies Config;
