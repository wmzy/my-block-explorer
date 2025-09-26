import type { Config } from "drizzle-kit";

export default {
  schema: "./src/database/schema.ts",
  out: "./drizzle",
  dialect: "postgresql", // 使用 PostgreSQL 语法（我们的适配器兼容）
  casing: "snake_case",
  // 注意：Drizzle Kit 无法直接连接到我们的 DuckDB 适配器
  // 这个配置主要用于 schema 生成和 SQL 语法
  // 实际的数据库连接在应用程序中通过我们的适配器处理connectionString: process.env.DATABASE_URL || "duckdb://data/blockchain.db",
  // 实际的数据库连接在应用程序中通过我们的适配器处理
  verbose: true,
  strict: true,
} satisfies Config;
