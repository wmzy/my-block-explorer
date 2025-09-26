import { drizzle } from "drizzle-orm/postgres-js";
import { createDuckDBAdapter } from "./duckdb-postgres-adapter";
import * as schema from "./schema";

// 创建 DuckDB 适配器
const duckdbAdapter = createDuckDBAdapter(
  process.env.DATABASE_URL || "duckdb://data/blockchain.db"
);

// 配置 Drizzle ORM
export const db = drizzle(duckdbAdapter, { schema, logger: true });

// 导出所有表和类型
export * from "./schema";
