import { Hono } from "hono";
import { BlockService } from "@/server/services/BlockService";
import { TransactionService } from "@/server/services/TransactionService";
import { AddressService } from "@/server/services/AddressService";
import { RpcManager } from "@/server/services/RpcManager";
import { validateChainId } from "@/server/middleware/validation";
import { timingMiddleware } from "@/server/middleware/timing";
import {
  detectSearchType,
  sanitizeInput,
  isValidChainId,
} from "@/shared/utils/validation";
import { db, searchHistory } from "@/server/database/drizzle";

// 创建服务实例
const rpcManager = new RpcManager();
const blockService = new BlockService(rpcManager);
const transactionService = new TransactionService(rpcManager);
const addressService = new AddressService(rpcManager);

// 创建搜索路由
export const searchRouter = new Hono();

// 添加通用中间件
searchRouter.use("*", timingMiddleware);

// 通用搜索接口
// GET /api/search?q=0x123...&chainId=1
searchRouter.get("/", async (c) => {
  try {
    const query = c.req.query("q");
    const chainIdParam = c.req.query("chainId");

    if (!query || typeof query !== "string") {
      return con(
        {
          code: "MISSING_QUERY",
          message: "Search query is required",
        },
        400
      );
    }

    const sanitizedQuery = sanitizeInput(query);
    const searchType = detectSearchType(sanitizedQuery);

    if (searchType === "unknown") {
      return con(
        {
          code: "INVALID_QUERY",
          message: "Invalid search query format",
        },
        400
      );
    }

    // 如果提供了chainId，验证它
    let chainId: number | null = null;
    if (chainIdParam) {
      if (!isValidChainId(chainIdParam)) {
        return con(
          {
            code: "INVALID_CHAIN_ID",
            message: "Invalid chain ID",
          },
          400
        );
      }
      chainId = parseInt(chainIdParam, 10);
    }

    let results: any = {};
    let resultType = "";
    let resultId = "";

    try {
      switch (searchType) {
        case "address":
          if (chainId) {
            const addressInfo = await addressService.getAddressInfo(
              chainId,
              sanitizedQuery
            );
            results = { type: "address", data: addressInfo };
            resultType = "address";
            resultId = sanitizedQuery;
          } else {
            // 如果没有指定链，返回支持的链列表让用户选择
            results = {
              type: "address_select_chain",
              address: sanitizedQuery,
              supportedChains: rpcManager
                .getAllUserRpcConfigs()
                .map((config) => ({
                  chainId: config.chainId,
                  name: rpcManager.getChainName(config.chainId),
                })),
            };
          }
          break;

        case "hash":
          if (chainId) {
            // 首先尝试作为交易哈希搜索
            const transaction = await transactionService.getTransactionByHash(
              chainId,
              sanitizedQuery
            );
            if (transaction) {
              results = { type: "transaction", data: transaction };
              resultType = "transaction";
              resultId = sanitizedQuery;
            } else {
              // 如果不是交易，尝试作为区块哈希搜索
              const block = await blockService.getBlockByHash(
                chainId,
                sanitizedQuery
              );
              if (block) {
                results = { type: "block", data: block };
                resultType = "block";
                resultId = sanitizedQuery;
              } else {
                return con(
                  {
                    code: "NOT_FOUND",
                    message: "Transaction or block not found",
                  },
                  404
                );
              }
            }
          } else {
            results = {
              type: "hash_select_chain",
              hash: sanitizedQuery,
              supportedChains: rpcManager
                .getAllUserRpcConfigs()
                .map((config) => ({
                  chainId: config.chainId,
                  name: rpcManager.getChainName(config.chainId),
                })),
            };
          }
          break;

        case "block":
          if (chainId) {
            const blockNumber = parseInt(sanitizedQuery, 10);
            const block = await blockService.getBlockByNumber(
              chainId,
              blockNumber
            );
            if (block) {
              results = { type: "block", data: block };
              resultType = "block";
              resultId = blockNumber.toString();
            } else {
              return con(
                {
                  code: "BLOCK_NOT_FOUND",
                  message: `Block ${blockNumber} not found`,
                },
                404
              );
            }
          } else {
            results = {
              type: "block_select_chain",
              blockNumber: parseInt(sanitizedQuery, 10),
              supportedChains: rpcManager
                .getAllUserRpcConfigs()
                .map((config) => ({
                  chainId: config.chainId,
                  name: rpcManager.getChainName(config.chainId),
                })),
            };
          }
          break;

        default:
          return con(
            {
              code: "UNSUPPORTED_SEARCH_TYPE",
              message: "Unsupported search type",
            },
            400
          );
      }

      // 记录搜索历史
      if (chainId && resultType && resultId) {
        try {
          await db.insert(searchHistory).values({
            chainId,
            query: sanitizedQuery,
            resultType,
            resultId,
          });
        } catch (error) {
          // 搜索历史记录失败不影响搜索结果
          console.warn("Failed to record search history:", error);
        }
      }

      c.header("X-Search-Type", searchType);
      c.header("X-Result-Type", results.type);
      if (chainId) {
        c.header("X-Chain-Id", chainId.toString());
      }

      return con(results);
    } catch (error) {
      console.error("Search error:", error);
      throw error;
    }
  } catch (error) {
    throw error;
  }
});

// 链特定搜索接口
// GET /api/chains/:chainId/search?q=0x123...
searchRouter.get("/:chainId/search", validateChainId, async (c) => {
  try {
    const chainId = c.get("chainId");
    const query = c.req.query("q");

    if (!query || typeof query !== "string") {
      return con(
        {
          code: "MISSING_QUERY",
          message: "Search query is required",
        },
        400
      );
    }

    const sanitizedQuery = sanitizeInput(query);
    const searchType = detectSearchType(sanitizedQuery);

    if (searchType === "unknown") {
      return con(
        {
          code: "INVALID_QUERY",
          message: "Invalid search query format",
        },
        400
      );
    }

    let results: any = {};
    let resultType = "";
    let resultId = "";

    switch (searchType) {
      case "address":
        const addressInfo = await addressService.getAddressInfo(
          chainId,
          sanitizedQuery
        );
        results = { type: "address", data: addressInfo };
        resultType = "address";
        resultId = sanitizedQuery;
        break;

      case "hash":
        // 首先尝试作为交易哈希搜索
        const transaction = await transactionService.getTransactionByHash(
          chainId,
          sanitizedQuery
        );
        if (transaction) {
          results = { type: "transaction", data: transaction };
          resultType = "transaction";
          resultId = sanitizedQuery;
        } else {
          // 如果不是交易，尝试作为区块哈希搜索
          const block = await blockService.getBlockByHash(
            chainId,
            sanitizedQuery
          );
          if (block) {
            results = { type: "block", data: block };
            resultType = "block";
            resultId = sanitizedQuery;
          } else {
            return con(
              {
                code: "NOT_FOUND",
                message: "Transaction or block not found",
              },
              404
            );
          }
        }
        break;

      case "block":
        const blockNumber = parseInt(sanitizedQuery, 10);
        const block = await blockService.getBlockByNumber(chainId, blockNumber);
        if (block) {
          results = { type: "block", data: block };
          resultType = "block";
          resultId = blockNumber.toString();
        } else {
          return con(
            {
              code: "BLOCK_NOT_FOUND",
              message: `Block ${blockNumber} not found`,
            },
            404
          );
        }
        break;

      default:
        return con(
          {
            code: "UNSUPPORTED_SEARCH_TYPE",
            message: "Unsupported search type",
          },
          400
        );
    }

    // 记录搜索历史
    try {
      await db.insert(searchHistory).values({
        chainId,
        query: sanitizedQuery,
        resultType,
        resultId,
      });
    } catch (error) {
      console.warn("Failed to record search history:", error);
    }

    c.header("X-Search-Type", searchType);
    c.header("X-Result-Type", results.type);
    c.header("X-Chain-Id", chainId.toString());

    return con(results);
  } catch (error) {
    throw error;
  }
});

// 获取搜索历史
// GET /api/chains/:chainId/search/history
searchRouter.get("/:chainId/search/history", validateChainId, async (c) => {
  try {
    const chainId = c.get("chainId");
    const limit = parseInt(c.req.query("limit") || "20", 10);

    if (limit < 1 || limit > 100) {
      return con(
        {
          code: "INVALID_LIMIT",
          message: "Limit must be between 1 and 100",
        },
        400
      );
    }

    const history = await db
      .select()
      .from(searchHistory)
      .where(eq(searchHistory.chainId, chainId))
      .orderBy(desc(searchHistory.searchedAt))
      .limit(limit);

    c.header("X-Data-Source", "db");
    c.header("X-Chain-Id", chainId.toString());
    c.header("X-Total-Count", history.length.toString());

    return con({ data: history });
  } catch (error) {
    throw error;
  }
});
