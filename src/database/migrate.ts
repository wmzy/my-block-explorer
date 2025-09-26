import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./drizzle";

/**
 * 数据库迁移脚本
 * 使用 Drizzle ORM 的标准迁移系统
 */
async function runMigrations() {
  const duckdb = await db.$client.getDuckDB();
  const connection = await duckdb.connect();
  await connection.run('CREATE SCHEMA IF NOT EXISTS "drizzle"');
  await connection.run("CREATE TYPE IF NOT EXISTS SERIAL AS INTEGER;");
  await connection.run("CREATE SEQUENCE IF NOT EXISTS serial_seq");
  await connection.run(
    `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL DEFAULT nextval('serial_seq') PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
     ) `
  );
  await migrate(db, {
    migrationsFolder: "./drizzle",
  });
}

export { runMigrations as migrate };

// 如果直接运行此脚本，执行迁移
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("🚀 Starting database migration...");
  runMigrations()
    .then(() => {
      console.log("Migration finished");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Migration failed:", error);
      process.exit(1);
    });
}
