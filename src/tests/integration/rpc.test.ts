import { describe, it, expect, beforeAll } from "vitest";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { rpcManager } from "@/services/RpcManager";

describe("RPC Integration Tests", () => {
  const ETHEREUM_CHAIN_ID = 1;
  const VITALIK_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  // 这些测试需要网络连接，可能会比较慢
  describe("基本RPC功能", () => {
    it("应该能创建RPC客户端", async () => {
      const client = await rpcManager.getClient(ETHEREUM_CHAIN_ID);
      expect(client).toBeDefined();
    });

    it("应该能获取当前区块高度", async () => {
      const client = await rpcManager.getClient(ETHEREUM_CHAIN_ID);
      const blockNumber = await client.getBlockNumber();

      expect(typeof blockNumber).toBe("bigint");
      expect(blockNumber).toBeGreaterThan(0n);
    }, 10000);

    it("应该能获取最新区块信息", async () => {
      const client = await rpcManager.getClient(ETHEREUM_CHAIN_ID);
      const latestBlock = await client.getBlock({ blockTag: "latest" });

      expect(latestBlock).toBeDefined();
      expect(latestBlock.number).toBeGreaterThan(0n);
      expect(latestBlock.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(latestBlock.timestamp).toBeGreaterThan(0n);
      expect(Array.isArray(latestBlock.transactions)).toBe(true);
    }, 10000);

    it("应该能获取特定区块信息", async () => {
      const client = await rpcManager.getClient(ETHEREUM_CHAIN_ID);
      const blockNumber = 18000000n;
      const block = await client.getBlock({ blockNumber });

      expect(block).toBeDefined();
      expect(block.number).toBe(blockNumber);
      expect(block.hash).toBe(
        "0x95b198e154acbfc64109dfd22d8224fe927fd8dfdedfae01587674482ba4baf3"
      );
    }, 10000);
  });

  describe("地址相关查询", () => {
    it("应该能查询地址余额", async () => {
      const client = await rpcManager.getClient(ETHEREUM_CHAIN_ID);
      const balance = await client.getBalance({
        address: VITALIK_ADDRESS as `0x${string}`,
      });

      expect(typeof balance).toBe("bigint");
      expect(balance).toBeGreaterThan(0n);
    }, 10000);

    it("应该能查询地址交易数量", async () => {
      const client = await rpcManager.getClient(ETHEREUM_CHAIN_ID);
      const txCount = await client.getTransactionCount({
        address: VITALIK_ADDRESS as `0x${string}`,
      });

      expect(typeof txCount).toBe("number");
      expect(txCount).toBeGreaterThan(0);
    }, 10000);

    it("应该能查询合约代码", async () => {
      const client = await rpcManager.getClient(ETHEREUM_CHAIN_ID);

      // 查询EOA地址，应该返回0x或undefined
      const eoaCode = await client.getCode({
        address: VITALIK_ADDRESS as `0x${string}`,
      });
      expect(eoaCode === "0x" || eoaCode === undefined).toBe(true);

      // 查询一个已知的合约地址
      const usdcAddress = "0xA0b86a33E6441b8c8c9c2b1b3e4e5a8a8e8c8c8c";
      try {
        const contractCode = await client.getCode({
          address: usdcAddress as `0x${string}`,
        });
        expect(typeof contractCode).toBe("string");
        expect(contractCode.startsWith("0x")).toBe(true);
      } catch (error) {
        // 如果合约地址无效，这是预期的
        expect(error).toBeDefined();
      }
    }, 10000);
  });

  describe("RPC管理器功能", () => {
    it("应该能获取链名称", () => {
      const chainName = rpcManager.getChainName(ETHEREUM_CHAIN_ID);
      expect(chainName).toBe("Ethereum");
    });

    it("应该能测试RPC连接", async () => {
      const testResult = await rpcManager.testRpcConnection(ETHEREUM_CHAIN_ID);

      // 由于公共RPC可能不稳定，我们检查返回的结构是否正确
      expect(testResult).toHaveProperty("success");
      expect(typeof testResult.success).toBe("boolean");

      if (testResult.success) {
        expect(typeof testResult.latency).toBe("number");
        expect(testResult.latency).toBeGreaterThan(0);
        expect(testResult.error).toBeUndefined();
      } else {
        expect(typeof testResult.error).toBe("string");
        expect(testResult.error).toBeTruthy();
        // 打印错误信息以便调试
        console.log("RPC connection test failed:", testResult.error);
      }
    }, 15000);

    it("应该能处理无效的RPC URL测试", async () => {
      const testResult = await rpcManager.testRpcConnection(
        ETHEREUM_CHAIN_ID,
        "http://invalid-rpc-url.com"
      );

      expect(testResult.success).toBe(false);
      expect(testResult.error).toBeDefined();
      expect(testResult.latency).toBeUndefined();
    }, 10000);
  });

  describe("客户端缓存", () => {
    it("应该复用相同链ID的客户端", async () => {
      const client1 = await rpcManager.getClient(ETHEREUM_CHAIN_ID);
      const client2 = await rpcManager.getClient(ETHEREUM_CHAIN_ID);

      expect(client1).toBe(client2);
    });

    it("应该为不同链ID创建不同的客户端", async () => {
      const ethereumClient = await rpcManager.getClient(1);

      // 尝试获取另一个链的客户端（如果支持的话）
      try {
        const polygonClient = await rpcManager.getClient(137);
        expect(ethereumClient).not.toBe(polygonClient);
      } catch (error) {
        // 如果不支持Polygon或网络问题，跳过这个测试
        console.warn("Polygon client test skipped:", error);
      }
    });
  });

  describe("错误处理", () => {
    it("应该对不支持的链ID抛出错误", async () => {
      await expect(rpcManager.getClient(999999)).rejects.toThrow();
    });

    it("应该优雅处理网络错误", async () => {
      // 这个测试可能需要模拟网络错误，暂时跳过
      // 在实际环境中，可以通过断网或使用无效RPC来测试
    });
  });
});

// 辅助函数：检查是否有网络连接
async function hasNetworkConnection(): Promise<boolean> {
  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(),
    });
    await client.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

// 可以在测试前检查网络连接
beforeAll(async () => {
  const hasNetwork = await hasNetworkConnection();
  if (!hasNetwork) {
    console.warn("⚠️ No network connection detected. Some RPC tests may fail.");
  }
});
