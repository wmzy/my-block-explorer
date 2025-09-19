import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { timing } from "hono/timing";
import {
  getChainName,
  getChainSymbol,
  isChainSupported,
  getSupportedChainIds,
} from "./config/chains";
import { searchService } from "./services/SearchService";
import { blockService } from "./services/BlockService";
import { transactionService } from "./services/TransactionService";
import { addressService } from "./services/AddressService";
import { rpcManager } from "./services/RpcManager";
import {
  formatBlockForApi,
  formatTransactionForApi,
  formatAddressForApi,
  formatStatsForApi,
  safeJsonResponse,
} from "./utils/serialization";

// Create API app
const app = new Hono();

// Middleware
app.use("*", cors());
app.use("*", logger());
app.use("*", timing());

// API info endpoint
app.get("/api", (c) => {
  return c.json({
    name: "Block Explorer API",
    version: "1.0.0",
    description: "A modern blockchain explorer API",
    endpoints: {
      health: "/api/health",
      search: "/api/search?q={query}",
      stats: "/api/stats/overview",
      blocks: "/api/blocks",
      transactions: "/api/transactions",
      addresses: "/api/addresses",
    },
    timestamp: new Date().toISOString(),
  });
});

// Health check
app.get("/api/health", (c) => {
  return c.json({
    status: "healthy",
    message: "Block Explorer API is running",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// Search functionality
app.get("/api/search", (c) => {
  const query = c.req.query("q");

  if (!query) {
    return c.json(
      {
        error: "Missing query parameter",
        message: "Please provide a 'q' parameter",
      },
      400
    );
  }

  // Detect search type
  let type = "unknown";
  if (query.startsWith("0x") && query.length === 42) {
    type = "address";
  } else if (query.startsWith("0x") && query.length === 66) {
    type = "transaction";
  } else if (/^[a-fA-F0-9]{40}$/.test(query)) {
    type = "address"; // Address without 0x prefix
  } else if (/^[a-fA-F0-9]{64}$/.test(query)) {
    type = "transaction"; // Transaction hash without 0x prefix
  } else if (/^\d+$/.test(query)) {
    type = "block";
  }

  return c.json({
    query,
    type,
    result: {
      found: false,
      message: `模拟搜索结果 - 类型: ${type}, 查询: ${query}`,
      data: null,
      suggestions: [
        "这是模拟数据，真实功能将在完整版本中实现",
        "当前支持地址、交易哈希和区块号的搜索",
        "数据库集成完成后将提供真实结果",
      ],
    },
    timestamp: new Date().toISOString(),
  });
});

// Chain-specific search functionality
app.get("/api/chains/:chainId/search", async (c) => {
  const chainIdParam = c.req.param("chainId");
  const query = c.req.query("q");

  if (!chainIdParam) {
    return c.json(
      {
        error: "Missing chain ID",
        message: "Please provide a valid chain ID",
      },
      400
    );
  }

  const chainId = parseInt(chainIdParam);
  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json(
      {
        error: "Unsupported chain",
        message: `Chain ID ${chainId} is not supported`,
        supportedChains: getSupportedChainIds(),
      },
      400
    );
  }

  if (!query) {
    return c.json(
      {
        error: "Missing query parameter",
        message: "Please provide a 'q' parameter",
      },
      400
    );
  }

  try {
    // 使用真实的搜索服务
    const searchResult = await searchService.search(chainId, query);

    // 设置响应头
    c.header("X-Data-Source", searchResult.found ? "blockchain" : "cache");
    c.header("X-Chain-Name", getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      chainSymbol: getChainSymbol(chainId),
      query: searchResult.query,
      type: searchResult.type,
      found: searchResult.found,
      data: searchResult.data || null,
      suggestions: searchResult.suggestions || [],
      error: searchResult.error || null,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    console.error("Search API error:", error);

    return c.json(
      {
        error: "Search failed",
        message:
          error instanceof Error ? error.message : "Internal server error",
      },
      500
    );
  }
});

// Block APIs
app.get("/api/chains/:chainId/blocks/latest", async (c) => {
  const chainId = parseInt(c.req.param("chainId"));

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json({ error: "Unsupported chain" }, 400);
  }

  try {
    const block = await blockService.getLatestBlock(chainId);
    c.header("X-Data-Source", "blockchain");
    c.header("X-Chain-Name", getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      block: formatBlockForApi(block),
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    console.error("Latest block API error:", error);
    return c.json({ error: "Failed to get latest block" }, 500);
  }
});

app.get("/api/chains/:chainId/blocks/:blockNumber", async (c) => {
  const chainId = parseInt(c.req.param("chainId"));
  const blockNumber = c.req.param("blockNumber");

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json({ error: "Unsupported chain" }, 400);
  }

  try {
    const block = await blockService.getBlockByNumber(
      chainId,
      BigInt(blockNumber)
    );

    if (!block) {
      return c.json({ error: "Block not found" }, 404);
    }

    c.header("X-Data-Source", "blockchain");
    c.header("X-Chain-Name", getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      block: formatBlockForApi(block),
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    console.error("Block API error:", error);
    return c.json({ error: "Failed to get block" }, 500);
  }
});

app.get("/api/chains/:chainId/blocks", async (c) => {
  const chainId = parseInt(c.req.param("chainId"));
  const limit = parseInt(c.req.query("limit") || "20");
  const offset = parseInt(c.req.query("offset") || "0");

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json({ error: "Unsupported chain" }, 400);
  }

  try {
    const result = await blockService.getBlocks(chainId, limit, offset);
    c.header("X-Data-Source", "database");
    c.header("X-Chain-Name", getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      blocks: result.blocks.map(formatBlockForApi),
      total: result.total,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    console.error("Blocks list API error:", error);
    return c.json({ error: "Failed to get blocks" }, 500);
  }
});

// Transaction APIs
app.get("/api/chains/:chainId/transactions/:hash", async (c) => {
  const chainId = parseInt(c.req.param("chainId"));
  const hash = c.req.param("hash");

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json({ error: "Unsupported chain" }, 400);
  }

  try {
    const transaction = await transactionService.getTransactionByHash(
      chainId,
      hash
    );

    if (!transaction) {
      return c.json({ error: "Transaction not found" }, 404);
    }

    c.header("X-Data-Source", "blockchain");
    c.header("X-Chain-Name", getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      transaction: formatTransactionForApi(transaction),
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    console.error("Transaction API error:", error);
    return c.json({ error: "Failed to get transaction" }, 500);
  }
});

app.get("/api/chains/:chainId/transactions", async (c) => {
  const chainId = parseInt(c.req.param("chainId"));
  const limit = parseInt(c.req.query("limit") || "20");

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json({ error: "Unsupported chain" }, 400);
  }

  try {
    const transactions = await transactionService.getLatestTransactions(
      chainId,
      limit
    );
    c.header("X-Data-Source", "database");
    c.header("X-Chain-Name", getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      transactions: transactions.map(formatTransactionForApi),
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    console.error("Transactions API error:", error);
    return c.json({ error: "Failed to get transactions" }, 500);
  }
});

// Address APIs
app.get("/api/chains/:chainId/addresses/:address", async (c) => {
  const chainId = parseInt(c.req.param("chainId"));
  const address = c.req.param("address");

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json({ error: "Unsupported chain" }, 400);
  }

  try {
    const addressInfo = await addressService.getAddressInfo(chainId, address);
    c.header("X-Data-Source", "blockchain");
    c.header("X-Chain-Name", getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address: formatAddressForApi(addressInfo),
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    console.error("Address API error:", error);
    return c.json({ error: "Failed to get address info" }, 500);
  }
});

app.get("/api/chains/:chainId/addresses/:address/transactions", async (c) => {
  const chainId = parseInt(c.req.param("chainId"));
  const address = c.req.param("address");
  const limit = parseInt(c.req.query("limit") || "20");
  const offset = parseInt(c.req.query("offset") || "0");

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json({ error: "Unsupported chain" }, 400);
  }

  try {
    const result = await addressService.getAddressTransactions(
      chainId,
      address,
      limit,
      offset
    );
    c.header("X-Data-Source", result.method);
    c.header("X-Chain-Name", getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address,
      transactions: result.transactions.map(formatTransactionForApi),
      total: result.total,
      method: result.method,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    console.error("Address transactions API error:", error);
    return c.json({ error: "Failed to get address transactions" }, 500);
  }
});

// Stats overview
app.get("/api/stats/overview", async (c) => {
  try {
    const supportedChainIds = getSupportedChainIds();
    const chainStats = [];

    // 获取前10个链的统计信息
    const topChains = supportedChainIds.slice(0, 10);

    for (const chainId of topChains) {
      try {
        const [blockStats, txStats] = await Promise.all([
          blockService.getBlockStats(chainId).catch(() => ({
            totalBlocks: 0,
            latestBlock: null,
            avgBlockTime: null,
            avgGasUsed: null,
          })),
          transactionService.getTransactionStats(chainId).catch(() => ({
            totalTransactions: 0,
            avgGasPrice: null,
            avgGasUsed: null,
            successRate: 0,
          })),
        ]);

        chainStats.push({
          chainId,
          chainName: getChainName(chainId),
          chainSymbol: getChainSymbol(chainId),
          isIndexed: blockStats.totalBlocks > 0,
          totalBlocks: blockStats.totalBlocks,
          totalTransactions: txStats.totalTransactions,
          latestBlock: blockStats.latestBlock?.toString() || null,
          avgBlockTime: blockStats.avgBlockTime,
          successRate: txStats.successRate,
        });
      } catch (error) {
        console.warn(`Failed to get stats for chain ${chainId}:`, error);
        chainStats.push({
          chainId,
          chainName: getChainName(chainId),
          chainSymbol: getChainSymbol(chainId),
          isIndexed: false,
          totalBlocks: 0,
          totalTransactions: 0,
          latestBlock: null,
          avgBlockTime: null,
          successRate: 0,
        });
      }
    }

    const totalBlocks = chainStats.reduce(
      (sum, chain) => sum + chain.totalBlocks,
      0
    );
    const totalTransactions = chainStats.reduce(
      (sum, chain) => sum + chain.totalTransactions,
      0
    );
    const indexedChains = chainStats.filter((chain) => chain.isIndexed).length;

    c.header("X-Data-Source", "database");

    return c.json({
      supportedChains: supportedChainIds.length,
      indexedChains,
      totalBlocks,
      totalTransactions,
      chains: chainStats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Stats overview API error:", error);
    return c.json({ error: "Failed to get stats overview" }, 500);
  }
});

// 404 handler for API routes
app.notFound((c) => {
  return c.json(
    {
      error: "Not Found",
      message: `API endpoint not found: ${c.req.path}`,
      availableEndpoints: [
        "/api",
        "/api/health",
        "/api/search?q={query}",
        "/api/stats/overview",
      ],
    },
    404
  );
});

// Error handler
app.onError((err, c) => {
  console.error("API Error:", err);
  return c.json(
    {
      error: "Internal Server Error",
      message: err.message,
    },
    500
  );
});

export default app;
