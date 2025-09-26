import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db, userRpcConfigs } from "@/database/drizzle";
import { eq } from "drizzle-orm";

describe("DuckDB + Drizzle ORM", () => {
  beforeEach(async () => {
    // 清理测试数据
    await db.delete(userRpcConfigs).where(eq(userRpcConfigs.chainId, 999));
  });

  afterEach(async () => {
    // 清理测试数据
    await db.delete(userRpcConfigs).where(eq(userRpcConfigs.chainId, 999));
  });

  describe("基本功能", () => {
    it("应该支持基本的SELECT查询", async () => {
      const result = await db.execute("SELECT 1 as test");
      expect(result).toEqual([{ test: 1 }]);
    });

    it("应该支持表查询", async () => {
      const result = await db.select().from(userRpcConfigs);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("CRUD操作", () => {
    it("应该支持INSERT操作", async () => {
      // 插入数据
      await db.insert(userRpcConfigs).values({
        chainId: 999,
        name: "Test RPC",
        url: "https://test.rpc",
        maxEventRange: 5000,
      });

      // 查询数据
      const result = await db
        .select()
        .from(userRpcConfigs)
        .where(eq(userRpcConfigs.chainId, 999));

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        chainId: 999,
        name: "Test RPC",
        url: "https://test.rpc",
        maxEventRange: 5000,
      });
    });

    it("应该支持UPDATE操作", async () => {
      // 插入数据
      await db.insert(userRpcConfigs).values({
        chainId: 999,
        name: "Test RPC",
        url: "https://test.rpc",
        maxEventRange: 5000,
      });

      // 更新数据
      await db
        .update(userRpcConfigs)
        .set({ maxEventRange: 10000 })
        .where(eq(userRpcConfigs.chainId, 999));

      // 验证更新
      const result = await db
        .select()
        .from(userRpcConfigs)
        .where(eq(userRpcConfigs.chainId, 999));

      expect(result[0].maxEventRange).toBe(10000);
    });

    it("应该支持DELETE操作", async () => {
      // 插入数据
      await db.insert(userRpcConfigs).values({
        chainId: 999,
        name: "Test RPC",
        url: "https://test.rpc",
        maxEventRange: 5000,
      });

      // 删除数据
      await db.delete(userRpcConfigs).where(eq(userRpcConfigs.chainId, 999));

      // 验证删除
      const result = await db
        .select()
        .from(userRpcConfigs)
        .where(eq(userRpcConfigs.chainId, 999));

      expect(result).toHaveLength(0);
    });
  });

  describe("字段映射", () => {
    it("应该正确映射数据库字段名到schema字段名", async () => {
      // 插入数据
      await db.insert(userRpcConfigs).values({
        chainId: 999, // schema中的字段名
        name: "Test RPC",
        url: "https://test.rpc",
        maxEventRange: 5000, // schema中的字段名
      });

      // 查询数据
      const result = await db
        .select()
        .from(userRpcConfigs)
        .where(eq(userRpcConfigs.chainId, 999));

      expect(result[0]).toHaveProperty("chainId", 999); // 返回schema字段名
      expect(result[0]).toHaveProperty("maxEventRange", 5000); // 返回schema字段名
    });
  });

  describe("类型转换", () => {
    it("应该正确处理时间戳类型", async () => {
      // 插入数据
      await db.insert(userRpcConfigs).values({
        chainId: 999,
        name: "Test RPC",
        url: "https://test.rpc",
        maxEventRange: 5000,
      });

      // 查询数据
      const result = await db
        .select()
        .from(userRpcConfigs)
        .where(eq(userRpcConfigs.chainId, 999));

      expect(result[0].createdAt).toBeInstanceOf(Date);
      expect(result[0].updatedAt).toBeInstanceOf(Date);
    });

    it("应该正确处理整数类型", async () => {
      // 插入数据
      await db.insert(userRpcConfigs).values({
        chainId: 999,
        name: "Test RPC",
        url: "https://test.rpc",
        maxEventRange: 5000,
      });

      // 查询数据
      const result = await db
        .select()
        .from(userRpcConfigs)
        .where(eq(userRpcConfigs.chainId, 999));

      expect(typeof result[0].chainId).toBe("number");
      expect(typeof result[0].maxEventRange).toBe("number");
    });
  });

  describe("事务支持", () => {
    it("应该支持事务操作", async () => {
      // 使用事务插入多条数据
      await db.transaction(async (tx) => {
        await tx.insert(userRpcConfigs).values({
          chainId: 999,
          name: "Test RPC 1",
          url: "https://test1.rpc",
          maxEventRange: 5000,
        });

        await tx.insert(userRpcConfigs).values({
          chainId: 998,
          name: "Test RPC 2",
          url: "https://test2.rpc",
          maxEventRange: 6000,
        });
      });

      // 验证数据
      const result1 = await db
        .select()
        .from(userRpcConfigs)
        .where(eq(userRpcConfigs.chainId, 999));
      const result2 = await db
        .select()
        .from(userRpcConfigs)
        .where(eq(userRpcConfigs.chainId, 998));

      expect(result1).toHaveLength(1);
      expect(result2).toHaveLength(1);

      // 清理
      await db.delete(userRpcConfigs).where(eq(userRpcConfigs.chainId, 998));
    });
  });
});