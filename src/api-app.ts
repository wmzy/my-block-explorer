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
app.get("/api/chains/:chainId/search", (c) => {
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

  const chainName = getChainName(chainId);
  const chainSymbol = getChainSymbol(chainId);

  return c.json({
    chainId,
    chainName,
    chainSymbol,
    query,
    type,
    result: {
      found: false,
      message: `在 ${chainName} 上搜索 ${type} - 查询: ${query}`,
      data: null,
      suggestions: [
        `这是 ${chainName} (Chain ID: ${chainId}) 的模拟搜索结果`,
        `当前支持地址、交易哈希和区块号的搜索`,
        `数据库集成完成后将提供真实的链上数据`,
        `原生代币: ${chainSymbol}`,
      ],
    },
    timestamp: new Date().toISOString(),
  });
});

// Stats overview
app.get("/api/stats/overview", (c) => {
  return c.json({
    supportedChains: 6,
    indexedChains: 0,
    totalBlocks: 0,
    totalTransactions: 0,
    chains: [
      {
        chainId: 1,
        chainName: "Ethereum",
        chainSymbol: "ETH",
        isIndexed: false,
      },
      {
        chainId: 137,
        chainName: "Polygon",
        chainSymbol: "MATIC",
        isIndexed: false,
      },
      {
        chainId: 56,
        chainName: "BSC",
        chainSymbol: "BNB",
        isIndexed: false,
      },
      {
        chainId: 42161,
        chainName: "Arbitrum",
        chainSymbol: "ETH",
        isIndexed: false,
      },
      {
        chainId: 8453,
        chainName: "Base",
        chainSymbol: "ETH",
        isIndexed: false,
      },
      {
        chainId: 10,
        chainName: "Optimism",
        chainSymbol: "ETH",
        isIndexed: false,
      },
    ],
    lastUpdated: new Date().toISOString(),
  });
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
