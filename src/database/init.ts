// 使用 Drizzle ORM 与 DuckDB 适配器
export { db } from "./drizzle";
export { DuckDBPostgresAdapter as DatabaseManager } from "./duckdb-postgres-adapter";

// 导出所有表和类型
export * from "./schema";

// 为了向后兼容，也导出 DuckDB 管理器
export { db as duckdb } from "./duckdb";
