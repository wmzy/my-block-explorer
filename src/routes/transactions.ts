import { Hono } from "hono";
import { TransactionService } from "@/server/services/TransactionService";
import { RpcManager } from "@/server/services/RpcManager";
import {
  validateChainId,
  validateTxHash,
  validateBlockNumber,
  validateAddress,
  validatePagination,
} from "@/server/middleware/validation";
import { timingMiddleware } from "@/server/middleware/timing";

// 创建服务实例
const rpcManager = new RpcManager();
const transactionService = new TransactionService(rpcManager);

// 创建交易路由
export const transactionsRouter = new Hono();

// 添加通用中间件
transactionsRouter.use("*", timingMiddleware);

// 根据交易哈希获取交易
// GET /api/chains/:chainId/transactions/:txHash
transactionsRouter.get(
  "/:chainId/transactions/:txHash",
  validateChainId,
  validateTxHash,
  async (c) => {
    try {
      const chainId = c.get("chainId");
      const txHash = c.get("txHash");

      const transaction = await transactionService.getTransactionByHash(
        chainId,
        txHash
      );

      if (!transaction) {
        return con(
          {
            code: "TRANSACTION_NOT_FOUND",
            message: "Transaction not found",
          },
          404
        );
      }

      const isFromCache =
        transaction.indexedAt &&
        new Date().getTime() - new Date(transaction.indexedAt).getTime() <
          60000;

      c.header("X-Data-Source", isFromCache ? "cache" : "rpc");
      c.header("X-Chain-Id", chainId.toString());

      return con(transaction);
    } catch (error) {
      throw error;
    }
  }
);

// 获取最新交易列表
// GET /api/chains/:chainId/transactions
transactionsRouter.get(
  "/:chainId/transactions",
  validateChainId,
  validatePagination,
  async (c) => {
    try {
      const chainId = c.get("chainId");
      const pagination = c.get("pagination");

      const result = await transactionService.getLatestTransactions(
        chainId,
        pagination
      );

      c.header("X-Data-Source", "db");
      c.header("X-Chain-Id", chainId.toString());
      c.header("X-Total-Count", result.pagination.total.toString());

      return con(result);
    } catch (error) {
      throw error;
    }
  }
);

// 获取指定区块的交易
// GET /api/chains/:chainId/blocks/:blockNumber/transactions
transactionsRouter.get(
  "/:chainId/blocks/:blockNumber/transactions",
  validateChainId,
  validateBlockNumber,
  validatePagination,
  async (c) => {
    try {
      const chainId = c.get("chainId");
      const blockNumber = c.get("blockNumber");
      const pagination = c.get("pagination");

      const result = await transactionService.getTransactionsByBlock(
        chainId,
        blockNumber,
        pagination
      );

      c.header("X-Data-Source", "db");
      c.header("X-Chain-Id", chainId.toString());
      c.header("X-Block-Number", blockNumber.toString());
      c.header("X-Total-Count", result.pagination.total.toString());

      return con(result);
    } catch (error) {
      throw error;
    }
  }
);

// 获取地址相关的交易
// GET /api/chains/:chainId/addresses/:address/transactions
transactionsRouter.get(
  "/:chainId/addresses/:address/transactions",
  validateChainId,
  validateAddress,
  validatePagination,
  async (c) => {
    try {
      const chainId = c.get("chainId");
      const address = c.get("address");
      const pagination = c.get("pagination");

      const result = await transactionService.getTransactionsByAddress(
        chainId,
        address,
        pagination
      );

      c.header("X-Data-Source", "db");
      c.header("X-Chain-Id", chainId.toString());
      c.header("X-Address", address);
      c.header("X-Total-Count", result.pagination.total.toString());

      return con(result);
    } catch (error) {
      throw error;
    }
  }
);

// 获取地址交易历史（简化版本，用于轻量级查询）
// GET /api/chains/:chainId/addresses/:address/transactions/history
transactionsRouter.get(
  "/:chainId/addresses/:address/transactions/history",
  validateChainId,
  validateAddress,
  async (c) => {
    try {
      const chainId = c.get("chainId");
      const address = c.get("address");
      const fromBlock = c.req.query("fromBlock");
      const toBlock = c.req.query("toBlock");

      const result = await transactionService.getAddressTransactionHistory(
        chainId,
        address,
        fromBlock ? parseInt(fromBlock, 10) : undefined,
        toBlock ? parseInt(toBlock, 10) : undefined
      );

      c.header("X-Data-Source", "hybrid");
      c.header("X-Chain-Id", chainId.toString());
      c.header("X-Address", address);
      c.header("X-Is-Complete", result.isComplete.toString());

      if (result.suggestion) {
        c.header("X-Suggestion", result.suggestion);
      }

      return con({
        data: result.transactions,
        isComplete: result.isComplete,
        suggestion: result.suggestion,
      });
    } catch (error) {
      throw error;
    }
  }
);

// 获取区块范围内的交易
// GET /api/chains/:chainId/transactions/range?fromBlock=123&toBlock=456
transactionsRouter.get(
  "/:chainId/transactions/range",
  validateChainId,
  validatePagination,
  async (c) => {
    try {
      const chainId = c.get("chainId");
      const pagination = c.get("pagination");
      const fromBlock = c.req.query("fromBlock");
      const toBlock = c.req.query("toBlock");

      const range = {
        fromBlock: fromBlock ? parseInt(fromBlock, 10) : undefined,
        toBlock: toBlock ? parseInt(toBlock, 10) : undefined,
      };

      const result = await transactionService.getTransactionsInRange(
        chainId,
        range,
        pagination
      );

      c.header("X-Data-Source", "db");
      c.header("X-Chain-Id", chainId.toString());
      c.header("X-Total-Count", result.pagination.total.toString());

      return con(result);
    } catch (error) {
      throw error;
    }
  }
);

// 获取交易统计信息
// GET /api/chains/:chainId/transactions/stats
transactionsRouter.get(
  "/:chainId/transactions/stats",
  validateChainId,
  async (c) => {
    try {
      const chainId = c.get("chainId");

      const stats = await transactionService.getTransactionStats(chainId);

      c.header("X-Data-Source", "db");
      c.header("X-Chain-Id", chainId.toString());

      return con(stats);
    } catch (error) {
      throw error;
    }
  }
);
