import { drizzle } from "drizzle-orm/postgres-js";
import { createDuckDBAdapter } from "./duckdb-postgres-adapter";
import * as schema from "./schema";

// 创建 DuckDB 适配器
const duckdbAdapter = createDuckDBAdapter(
  process.env.DATABASE_URL || "duckdb://data/blockchain.db"
);

// 配置 Drizzle ORM，确保与 drizzle.config.ts 中的 casing 配置一致
export const db = drizzle(duckdbAdapter, { 
  schema, 
  logger: true,
  casing: "snake_case" // 与 drizzle.config.ts 保持一致
});

// 导出所有表和类型
export * from "./schema";
