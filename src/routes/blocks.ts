import { Hono } from "hono";
import { BlockService } from "@/server/services/BlockService";
import { RpcManager } from "@/server/services/RpcManager";
import {
  getValidatedChainId,
  getValidatedBlockNumber,
} from "@/server/validation";
import { timingMiddleware } from "@/server/middleware/timing";

// 创建服务实例
const rpcManager = new RpcManager();
const blockService = new BlockService(rpcManager);

// 创建块路由
export const blocksRouter = new Hono();

// 添加通用中间件
blocksRouter.use("*", timingMiddleware);

// 获取最新区块列表
// GET /api/chains/:chainId/blocks
blocksRouter.get(
  "/:chainId/blocks",
  validateChainId,
  validatePagination,
  async (c) => {
    try {
      const chainId = getValidatedChainId(c.req.param("chainId"));
      const pagination = c.get("pagination");

      const result = await blockService.getLatestBlocks(chainId, pagination);

      // 设置响应头
      c.header("X-Data-Source", "db");
      c.header("X-Chain-Id", chainId.toString());
      c.header("X-Total-Count", result.pagination.total.toString());

      return c.json(result);
    } catch (error) {
      throw error;
    }
  }
);

// 根据区块号获取区块
// GET /api/chains/:chainId/blocks/:blockNumber
blocksRouter.get("/:chainId/blocks/:blockNumber", async (c) => {
  try {
    const chainId = getValidatedChainId(c.req.param("chainId"));
    const blockNumber = getValidatedBlockNumber(c.req.param("blockNumber"));

    const block = await blockService.getBlockByNumber(chainId, blockNumber);

    if (!block) {
      return c.json(
        {
          code: "BLOCK_NOT_FOUND",
          message: `Block ${blockNumber} not found`,
        },
        404
      );
    }

    // 判断数据来源
    const isFromCache =
      block.indexedAt &&
      new Date().getTime() - new Date(block.indexedAt).getTime() < 60000; // 1分钟内的数据认为是缓存

    c.header("X-Data-Source", isFromCache ? "cache" : "rpc");
    c.header("X-Chain-Id", chainId.toString());

    return c.json(block);
  } catch (error) {
    throw error;
  }
});

// 根据区块哈希获取区块
// GET /api/chains/:chainId/blocks/hash/:blockHash
blocksRouter.get(
  "/:chainId/blocks/hash/:blockHash",
  validateChainId,
  validateBlockHash,
  async (c) => {
    try {
      const chainId = getValidatedChainId(c.req.param("chainId"));
      const blockHash = c.get("blockHash");

      const block = await blockService.getBlockByHash(chainId, blockHash);

      if (!block) {
        return c.json(
          {
            code: "BLOCK_NOT_FOUND",
            message: "Block not found",
          },
          404
        );
      }

      const isFromCache =
        block.indexedAt &&
        new Date().getTime() - new Date(block.indexedAt).getTime() < 60000;

      c.header("X-Data-Source", isFromCache ? "cache" : "rpc");
      c.header("X-Chain-Id", chainId.toString());

      return c.json(block);
    } catch (error) {
      throw error;
    }
  }
);

// 获取区块范围
// GET /api/chains/:chainId/blocks/range?fromBlock=123&toBlock=456
blocksRouter.get(
  "/:chainId/blocks/range",
  validateChainId,
  validatePagination,
  async (c) => {
    try {
      const chainId = getValidatedChainId(c.req.param("chainId"));
      const pagination = c.get("pagination");
      const fromBlock = c.req.query("fromBlock");
      const toBlock = c.req.query("toBlock");

      const range = {
        fromBlock: fromBlock ? parseInt(fromBlock, 10) : undefined,
        toBlock: toBlock ? parseInt(toBlock, 10) : undefined,
      };

      const result = await blockService.getBlocksInRange(
        chainId,
        range,
        pagination
      );

      c.header("X-Data-Source", "db");
      c.header("X-Chain-Id", chainId.toString());
      c.header("X-Total-Count", result.pagination.total.toString());

      return c.json(result);
    } catch (error) {
      throw error;
    }
  }
);

// 获取最新区块号
// GET /api/chains/:chainId/blocks/latest/number
blocksRouter.get(
  "/:chainId/blocks/latest/number",
  validateChainId,
  async (c) => {
    try {
      const chainId = getValidatedChainId(c.req.param("chainId"));

      const latestBlockNumber =
        await blockService.getLatestBlockNumber(chainId);

      c.header("X-Data-Source", "rpc");
      c.header("X-Chain-Id", chainId.toString());

      return c.json({ blockNumber: latestBlockNumber });
    } catch (error) {
      throw error;
    }
  }
);

// 获取区块统计信息
// GET /api/chains/:chainId/blocks/stats
blocksRouter.get("/:chainId/blocks/stats", async (c) => {
  try {
    const chainId = c.get("chainId");

    const stats = await blockService.getBlockStats(chainId);

    c.header("X-Data-Source", "db");
    c.header("X-Chain-Id", chainId.toString());

    return c.json(stats);
  } catch (error) {
    throw error;
  }
});
