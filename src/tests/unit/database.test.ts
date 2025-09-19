import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabase } from "@/database/memory";

describe("MemoryDatabase", () => {
  let db: MemoryDatabase;

  beforeEach(() => {
    db = new MemoryDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  describe("基本功能", () => {
    it("应该正确初始化数据库表", () => {
      const tables = db.getTables();
      expect(tables).toContain("user_rpc_configs");
      expect(tables).toContain("blocks");
      expect(tables).toContain("transactions");
      expect(tables).toContain("indexed_addresses");
      expect(tables).toContain("search_history");
      expect(tables).toContain("user_preferences");
      expect(tables).toContain("access_history");
    });

    it("应该支持基本的SELECT查询", async () => {
      const result = await db.query("SELECT 1 as test");
      expect(result).toEqual([]);
    });
  });

  describe("数据操作", () => {
    it("应该支持INSERT和SELECT操作", async () => {
      // 插入数据
      await db.query(
        "INSERT OR REPLACE INTO user_preferences (key, value, updated_at) VALUES (?, ?, ?)",
        ["test_key", "test_value", new Date().toISOString()]
      );

      // 查询数据
      const result = await db.query(
        "SELECT * FROM user_preferences WHERE key = ?",
        ["test_key"]
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        key: "test_key",
        value: "test_value",
      });
    });

    it("应该支持INSERT OR REPLACE操作", async () => {
      const key = "replace_test";

      // 第一次插入
      await db.query(
        "INSERT OR REPLACE INTO user_preferences (key, value) VALUES (?, ?)",
        [key, "value1"]
      );

      // 第二次插入（替换）
      await db.query(
        "INSERT OR REPLACE INTO user_preferences (key, value) VALUES (?, ?)",
        [key, "value2"]
      );

      const result = await db.query(
        "SELECT * FROM user_preferences WHERE key = ?",
        [key]
      );

      expect(result).toHaveLength(1);
      expect(result[0].value).toBe("value2");
    });

    it("应该支持WHERE条件查询", async () => {
      // 插入多条数据
      await db.query(
        "INSERT OR REPLACE INTO blocks (chain_id, number, hash) VALUES (?, ?, ?)",
        [1, 100, "0x123"]
      );
      await db.query(
        "INSERT OR REPLACE INTO blocks (chain_id, number, hash) VALUES (?, ?, ?)",
        [2, 200, "0x456"]
      );

      // 按链ID查询
      const result = await db.query("SELECT * FROM blocks WHERE chain_id = ?", [
        1,
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].chain_id).toBe(1);
      expect(result[0].number).toBe(100);
    });

    it("应该支持ORDER BY排序", async () => {
      // 插入多条数据
      await db.query(
        "INSERT OR REPLACE INTO blocks (chain_id, number, hash) VALUES (?, ?, ?)",
        [1, 300, "0x789"]
      );
      await db.query(
        "INSERT OR REPLACE INTO blocks (chain_id, number, hash) VALUES (?, ?, ?)",
        [1, 100, "0x123"]
      );
      await db.query(
        "INSERT OR REPLACE INTO blocks (chain_id, number, hash) VALUES (?, ?, ?)",
        [1, 200, "0x456"]
      );

      // 按number降序查询
      const result = await db.query(
        "SELECT * FROM blocks WHERE chain_id = ? ORDER BY number DESC",
        [1]
      );

      expect(result).toHaveLength(3);
      expect(result[0].number).toBe(300);
      expect(result[1].number).toBe(200);
      expect(result[2].number).toBe(100);
    });

    it("应该支持LIMIT分页", async () => {
      // 插入多条数据
      for (let i = 1; i <= 5; i++) {
        await db.query(
          "INSERT OR REPLACE INTO blocks (chain_id, number, hash) VALUES (?, ?, ?)",
          [1, i, `0x${i.toString().padStart(3, "0")}`]
        );
      }

      // 限制查询结果
      const result = await db.query(
        "SELECT * FROM blocks WHERE chain_id = ? ORDER BY number ASC LIMIT ?",
        [1, 3]
      );

      expect(result).toHaveLength(3);
      expect(result[0].number).toBe(1);
      expect(result[2].number).toBe(3);
    });
  });

  describe("事务支持", () => {
    it("应该支持事务操作", async () => {
      await db.transaction(async () => {
        await db.query(
          "INSERT OR REPLACE INTO user_preferences (key, value) VALUES (?, ?)",
          ["tx_test1", "value1"]
        );
        await db.query(
          "INSERT OR REPLACE INTO user_preferences (key, value) VALUES (?, ?)",
          ["tx_test2", "value2"]
        );
      });

      const result = await db.query(
        "SELECT * FROM user_preferences WHERE key LIKE 'tx_test%'"
      );

      expect(result).toHaveLength(2);
    });
  });

  describe("错误处理", () => {
    it("应该优雅处理无效的SQL", async () => {
      const result = await db.query("INVALID SQL STATEMENT");
      expect(result).toEqual([]);
    });

    it("应该优雅处理不存在的表", async () => {
      const result = await db.query("SELECT * FROM non_existent_table");
      expect(result).toEqual([]);
    });
  });
});
