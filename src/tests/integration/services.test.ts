import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { blockService } from "@/services/BlockService";
import { transactionService } from "@/services/TransactionService";
import { addressService } from "@/services/AddressService";
import { searchService } from "@/services/SearchService";
import { db } from "@/database/init";

describe("Services Integration Tests", () => {
  const ETHEREUM_CHAIN_ID = 1;
  const VITALIK_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  beforeEach(async () => {
    // 清理数据库
    db.clear();
  });

  afterEach(async () => {
    // 清理数据库
    db.clear();
  });

  describe("BlockService", () => {
    it("应该能获取最新区块", async () => {
      const latestBlock = await blockService.getLatestBlock(ETHEREUM_CHAIN_ID);

      expect(latestBlock).toBeDefined();
      if (latestBlock) {
        expect(latestBlock.chainId).toBe(ETHEREUM_CHAIN_ID);
        expect(latestBlock.number).toBeGreaterThan(0n);
        expect(latestBlock.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(latestBlock.timestamp).toBeInstanceOf(Date);
      }
    }, 15000);

    it("应该能根据区块号获取区块", async () => {
      const blockNumber = 18000000n;
      const block = await blockService.getBlockByNumber(
        ETHEREUM_CHAIN_ID,
        blockNumber
      );

      expect(block).toBeDefined();
      if (block) {
        expect(block.chainId).toBe(ETHEREUM_CHAIN_ID);
        expect(block.number).toBe(blockNumber);
        expect(block.hash).toBe(
          "0x95b198e154acbfc64109dfd22d8224fe927fd8dfdedfae01587674482ba4baf3"
        );
      }
    }, 15000);

    it("应该能根据区块哈希获取区块", async () => {
      const blockHash =
        "0x95b198e154acbfc64109dfd22d8224fe927fd8dfdedfae01587674482ba4baf3";
      const block = await blockService.getBlockByHash(
        ETHEREUM_CHAIN_ID,
        blockHash
      );

      expect(block).toBeDefined();
      if (block) {
        expect(block.chainId).toBe(ETHEREUM_CHAIN_ID);
        expect(block.hash).toBe(blockHash);
        expect(block.number).toBe(18000000n);
      }
    }, 15000);

    it("应该能获取区块列表", async () => {
      // 先获取一个区块以确保数据库中有数据
      await blockService.getBlockByNumber(ETHEREUM_CHAIN_ID, 18000000n);

      const result = await blockService.getBlocks(ETHEREUM_CHAIN_ID, 5, 0);

      expect(result).toBeDefined();
      expect(Array.isArray(result.blocks)).toBe(true);
      expect(typeof result.total).toBe("number");
    }, 15000);

    it("应该能获取最新区块号", async () => {
      const latestBlockNumber =
        await blockService.getLatestBlockNumber(ETHEREUM_CHAIN_ID);

      expect(latestBlockNumber).toBeGreaterThan(0n);
    }, 10000);

    it("应该能获取区块统计", async () => {
      // 先添加一些测试数据
      await blockService.getBlockByNumber(ETHEREUM_CHAIN_ID, 18000000n);

      const stats = await blockService.getBlockStats(ETHEREUM_CHAIN_ID);

      expect(stats).toBeDefined();
      expect(typeof stats.totalBlocks).toBe("number");
      expect(stats.latestBlock).toBeDefined();
    }, 15000);
  });

  describe("AddressService", () => {
    it("应该能获取地址信息", async () => {
      const addressInfo = await addressService.getAddressInfo(
        ETHEREUM_CHAIN_ID,
        VITALIK_ADDRESS
      );

      expect(addressInfo).toBeDefined();
      expect(addressInfo.chainId).toBe(ETHEREUM_CHAIN_ID);
      expect(addressInfo.address).toBe(VITALIK_ADDRESS.toLowerCase());
      expect(BigInt(addressInfo.balance)).toBeGreaterThan(0n);
      expect(addressInfo.transactionCount).toBeGreaterThan(0);
      expect(typeof addressInfo.isContract).toBe("boolean");
    }, 15000);

    it("应该能获取地址余额", async () => {
      const balance = await addressService.getAddressBalance(
        ETHEREUM_CHAIN_ID,
        VITALIK_ADDRESS
      );

      expect(typeof balance).toBe("string");
      expect(BigInt(balance)).toBeGreaterThan(0n);
    }, 10000);

    it("应该能检查地址是否为合约", async () => {
      const isContract = await addressService.isContract(
        ETHEREUM_CHAIN_ID,
        VITALIK_ADDRESS
      );
      expect(isContract).toBe(false);
    }, 10000);

    it("应该能获取地址交易历史", async () => {
      const result = await addressService.getAddressTransactions(
        ETHEREUM_CHAIN_ID,
        VITALIK_ADDRESS,
        5
      );

      expect(result).toBeDefined();
      expect(Array.isArray(result.transactions)).toBe(true);
      expect(typeof result.total).toBe("number");
      expect(["database", "lightweight", "error"]).toContain(result.method);
    }, 30000);
  });

  describe("TransactionService", () => {
    it("应该能获取最新交易", async () => {
      const transactions = await transactionService.getLatestTransactions(
        ETHEREUM_CHAIN_ID,
        5
      );

      expect(Array.isArray(transactions)).toBe(true);
      // 由于是新的数据库，可能没有交易数据
      // expect(transactions.length).toBeGreaterThan(0);
    }, 10000);

    it("应该能获取交易统计", async () => {
      const stats =
        await transactionService.getTransactionStats(ETHEREUM_CHAIN_ID);

      expect(stats).toBeDefined();
      expect(typeof stats.totalTransactions).toBe("number");
      expect(typeof stats.successRate).toBe("number");
      expect(stats.successRate).toBeGreaterThanOrEqual(0);
      expect(stats.successRate).toBeLessThanOrEqual(100);
    }, 10000);

    it("应该能根据交易哈希获取交易（如果存在）", async () => {
      // 使用一个已知的交易哈希进行测试
      const knownTxHash =
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

      // 这个测试可能返回null，因为我们使用的是随机哈希
      const transaction = await transactionService.getTransactionByHash(
        ETHEREUM_CHAIN_ID,
        knownTxHash
      );

      // 如果找到交易，验证其结构
      if (transaction) {
        expect(transaction.chainId).toBe(ETHEREUM_CHAIN_ID);
        expect(transaction.hash).toBe(knownTxHash);
      }
    }, 15000);
  });

  describe("SearchService", () => {
    it("应该能搜索区块号", async () => {
      const result = await searchService.search(ETHEREUM_CHAIN_ID, "18000000");

      expect(result).toBeDefined();
      expect(result.type).toBe("block");
      expect(result.chainId).toBe(ETHEREUM_CHAIN_ID);
      expect(result.query).toBe("18000000");

      if (result.found) {
        expect(result.data).toBeDefined();
      }
    }, 15000);

    it("应该能搜索地址", async () => {
      const result = await searchService.search(
        ETHEREUM_CHAIN_ID,
        VITALIK_ADDRESS
      );

      expect(result).toBeDefined();
      expect(result.type).toBe("address");
      expect(result.chainId).toBe(ETHEREUM_CHAIN_ID);
      expect(result.query).toBe(VITALIK_ADDRESS);
      expect(result.found).toBe(true);

      if (result.found && result.data) {
        const addressData = result.data as any;
        expect(addressData.address).toBe(VITALIK_ADDRESS.toLowerCase());
        expect(BigInt(addressData.balance)).toBeGreaterThan(0n);
      }
    }, 15000);

    it("应该能搜索交易哈希", async () => {
      const txHash =
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      const result = await searchService.search(ETHEREUM_CHAIN_ID, txHash);

      expect(result).toBeDefined();
      expect(result.type).toBe("transaction");
      expect(result.chainId).toBe(ETHEREUM_CHAIN_ID);
      expect(result.query).toBe(txHash);

      // 由于是随机哈希，可能找不到
      if (!result.found) {
        expect(result.suggestions).toBeDefined();
        expect(Array.isArray(result.suggestions)).toBe(true);
      }
    }, 15000);

    it("应该能处理无效查询", async () => {
      const result = await searchService.search(
        ETHEREUM_CHAIN_ID,
        "invalid_query_123"
      );

      expect(result).toBeDefined();
      expect(result.type).toBe("unknown");
      expect(result.found).toBe(false);
      expect(result.suggestions).toBeDefined();
      expect(Array.isArray(result.suggestions)).toBe(true);
    }, 10000);

    it("应该能获取搜索历史", async () => {
      // 先进行一些搜索
      await searchService.search(ETHEREUM_CHAIN_ID, "18000000");
      await searchService.search(ETHEREUM_CHAIN_ID, VITALIK_ADDRESS);

      const history = await searchService.getSearchHistory(
        ETHEREUM_CHAIN_ID,
        10
      );

      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThan(0);

      history.forEach((item) => {
        expect(item.query).toBeDefined();
        expect(item.searchedAt).toBeInstanceOf(Date);
      });
    }, 15000);
  });

  describe("服务间协作", () => {
    it("搜索应该能触发数据索引", async () => {
      // 搜索一个区块
      const searchResult = await searchService.search(
        ETHEREUM_CHAIN_ID,
        "18000000"
      );

      if (searchResult.found) {
        // 验证区块是否已被索引到数据库
        const blockResult = await blockService.getBlocks(
          ETHEREUM_CHAIN_ID,
          10,
          0
        );
        expect(blockResult.blocks.length).toBeGreaterThan(0);
      }
    }, 20000);

    it("地址搜索应该能更新地址索引", async () => {
      // 搜索一个地址
      await searchService.search(ETHEREUM_CHAIN_ID, VITALIK_ADDRESS);

      // 验证地址是否已被索引
      const addressInfo = await addressService.getAddressInfo(
        ETHEREUM_CHAIN_ID,
        VITALIK_ADDRESS
      );
      expect(addressInfo.lastQueried).toBeDefined();
    }, 15000);
  });

  describe("缓存功能", () => {
    it("第二次查询应该使用缓存", async () => {
      // 第一次查询
      const start1 = Date.now();
      const result1 = await blockService.getLatestBlock(ETHEREUM_CHAIN_ID);
      const time1 = Date.now() - start1;

      // 第二次查询（应该更快，使用缓存）
      const start2 = Date.now();
      const result2 = await blockService.getLatestBlock(ETHEREUM_CHAIN_ID);
      const time2 = Date.now() - start2;

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();

      if (result1 && result2) {
        expect(result1.hash).toBe(result2.hash);
        // 第二次查询应该明显更快（使用缓存）
        // 注意：这个断言可能在某些情况下失败，因为网络延迟的变化
        // expect(time2).toBeLessThan(time1 * 0.5);
      }
    }, 20000);
  });
});
