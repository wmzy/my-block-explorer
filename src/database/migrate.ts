#!/usr/bin/env tsx

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./drizzle";
import { join } from "path";

/**
 * 数据库迁移脚本
 * 运行方式: npm run migrate
 */
async function runMigrations() {
  console.log("🚀 Starting database migration...");

  try {
    const migrationsFolder = join(process.cwd(), "src/database/migrations");

    await migrate(db, { migrationsFolder });

    console.log("✅ Database migration completed successfully!");

    // 创建基础索引和优化
    await createAdditionalIndexes();

    console.log("✅ Additional indexes created!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }

  process.exit(0);
}

/**
 * 创建额外的索引和优化
 */
async function createAdditionalIndexes() {
  try {
    // 为高频查询创建复合索引
    await db.execute(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS blocks_chain_number_desc_idx 
      ON blocks (chain_id, number DESC);
    `);

    await db.execute(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_chain_block_index_idx 
      ON transactions (chain_id, block_number, transaction_index);
    `);

    await db.execute(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_address_timestamp_idx 
      ON transactions (chain_id, from_address, timestamp DESC);
    `);

    await db.execute(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_to_address_timestamp_idx 
      ON transactions (chain_id, to_address, timestamp DESC);
    `);

    // 创建全文搜索索引
    await db.execute(`
      CREATE INDEX IF NOT EXISTS search_history_query_idx 
      ON search_history USING gin(to_tsvector('english', query));
    `);
  } catch (error) {
    console.warn("⚠️ Some additional indexes may have failed:", error);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  runMigrations();
}

export { runMigrations };
