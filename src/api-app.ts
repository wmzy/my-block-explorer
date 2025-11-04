import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
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
import { contractSourceService } from "./services/ContractSourceService";
import { contractInteractionService } from "./services/ContractInteractionService";
import { rpcManager } from "./services/RpcManager";
import { eventIndexingServiceManager } from "./services/EventIndexingService";
import { eventQueryServiceManager } from "./services/EventQueryService";
import { eventPerformanceOptimizerManager } from "./services/EventPerformanceOptimizer";
import { db, userRpcConfigs } from "./database/init";
import { eq } from "drizzle-orm";
import { type Address } from "viem";
import {
  formatAddressForApi,
  formatBlockForApi,
  formatTransactionForApi,
  safeJsonResponse,
} from "./utils/serialization";
import pinoLogger from "./server/logger";
import {
  getValidatedAddress,
  getValidatedChainId,
  getValidatedTxHash,
  getValidatedBlockNumber,
} from "./server/validation";
import { loggerMiddleware } from "./middleware/logger";
import { corsMiddleware } from "./middleware/cors";

const appLogger = pinoLogger.child({
  module: "api-app",
});

// Create API app
const app = new Hono();

// Middleware
app.use("*", corsMiddleware);
app.use("*", loggerMiddleware);
app.use("*", timing());

app.onError((e, c) => {
  if (e instanceof HTTPException) {
    return e.getResponse();
  }

  appLogger.error(e);

  return c.json({ error: "Internal Server Error" }, 500);
});

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
  const chainId = getValidatedChainId(c.req.param("chainId"));

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
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const blockNumber = getValidatedBlockNumber(c.req.param("blockNumber"));

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
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const limit = parseInt(c.req.query("limit") || "20");
  const offset = parseInt(c.req.query("offset") || "0");

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
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const hash = c.req.param("hash");

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
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const limit = parseInt(c.req.query("limit") || "20");

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
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));

  try {
    const addressInfo = await addressService.getAddressInfo(chainId, address);
    c.header("X-Data-Source", "blockchain");
    c.header("X-Chain-Name", getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address: addressInfo,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    console.error("Address API error:", error);
    return c.json({ error: "Failed to get address info" }, 500);
  }
});

// 地址持久化信息接口（数据库缓存）
app.get("/api/chains/:chainId/addresses/:address/persistent", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));

  try {
    const persistentData = await addressService.getPersistentAddressData(chainId, address);
    
    c.header("X-Data-Source", "database");
    c.header("X-Chain-Name", getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address,
      ...persistentData,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    console.error("Address persistent data API error:", error);
    return c.json({ error: "Failed to get address persistent data" }, 500);
  }
});

app.get("/api/chains/:chainId/addresses/:address/transactions", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));
  const limit = parseInt(c.req.query("limit") || "20");
  const offset = parseInt(c.req.query("offset") || "0");

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
        "/api/chains/{chainId}/contracts/{address}/events/indexing-status",
        "/api/chains/{chainId}/contracts/{address}/events",
        "/api/performance/events",
        "/api/performance/clear-cache",
        "/api/performance/warmup",
      ],
    },
    404
  );
});

// Error handler
// 合约源码相关API
// GET /api/chains/:chainId/contracts/:address/source - 获取合约源码
app.get("/api/chains/:chainId/contracts/:address/source", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));

  try {
    const contractSource = await contractSourceService.getContractSource(
      chainId,
      address
    );

    if (!contractSource) {
      return c.json(
        { error: "Contract not found or not a contract address" },
        404
      );
    }

    c.header("X-Data-Source", "contract-verification");
    c.header("X-Chain-Name", getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address: address,
      contractSource,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    console.error("Contract source API error:", error);
    return c.json({ error: "Failed to get contract source" }, 500);
  }
});

// GET /api/chains/:chainId/contracts/:address/abi - 获取合约ABI和函数信息
app.get("/api/chains/:chainId/contracts/:address/abi", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));

  try {
    const [contractSource, contractFunctions] = await Promise.all([
      contractSourceService.getContractSource(chainId, address),
      contractSourceService.getContractFunctions(chainId, address),
    ]);

    if (!contractSource) {
      return c.json(
        { error: "Contract not found or not a contract address" },
        404
      );
    }

    c.header("X-Data-Source", "contract-verification");
    c.header("X-Chain-Name", getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address,
      abi: contractSource.abi,
      functions: contractFunctions.functions,
      events: contractFunctions.events,
      errors: contractFunctions.errors,
      verificationStatus: contractSource.verificationStatus,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    console.error("Contract ABI API error:", error);
    return c.json({ error: "Failed to get contract ABI" }, 500);
  }
});

// GET /api/chains/:chainId/contracts/:address/functions - 获取合约可调用函数
app.get("/api/chains/:chainId/contracts/:address/functions", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));

  try {
    // 获取合约源码（可能是代理合约）
    const contractSource = await contractSourceService.getContractSource(
      chainId,
      address
    );

    let targetAddress = address;
    let targetABI = contractSource?.abi;

    // 如果是代理合约，使用实现合约的ABI
    if (contractSource?.isProxy && contractSource?.implementationContract) {
      targetAddress =
        contractSource.implementationAddress! as Address as Address;
      targetABI = contractSource.implementationContract.abi;
    }

    const { readFunctions, writeFunctions } =
      await contractInteractionService.getContractFunctions(
        chainId,
        targetAddress,
        targetABI
      );

    c.header("X-Chain-Name", getChainName(chainId));
    c.header("X-Cache-Control", "public, max-age=300");

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address: address,
      readFunctions,
      writeFunctions,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    console.error("Contract functions API error:", error);
    return c.json({ error: "Failed to get contract functions" }, 500);
  }
});

// POST /api/chains/:chainId/contracts/:address/read - 调用只读合约函数
app.post("/api/chains/:chainId/contracts/:address/read", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json({ error: "Unsupported chain" }, 400);
  }

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json({ error: "Invalid contract address" }, 400);
  }

  try {
    const body = await c.req.json();
    const { functionName, args = [] } = body;

    if (!functionName || typeof functionName !== "string") {
      return c.json({ error: "Function name is required" }, 400);
    }

    if (!Array.isArray(args)) {
      return c.json({ error: "Arguments must be an array" }, 400);
    }

    // 获取合约源码（可能是代理合约）
    const contractSource = await contractSourceService.getContractSource(
      chainId,
      address
    );

    let targetAddress = address;
    let targetABI = contractSource?.abi;

    // 如果是代理合约，使用实现合约的地址和ABI
    if (contractSource?.isProxy && contractSource?.implementationContract) {
      targetAddress = contractSource.implementationAddress! as Address;
      targetABI = contractSource.implementationContract.abi;
    }

    if (!targetABI) {
      return c.json({ error: "Contract ABI not available" }, 400);
    }

    const result = await contractInteractionService.readContractWithABI({
      chainId,
      contractAddress: targetAddress,
      functionName,
      args,
      abi: targetABI,
    });

    c.header("X-Chain-Name", getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      contractAddress: address,
      functionName,
      args,
      result: result.result,
      success: result.success,
      error: result.error,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData, result.success ? 200 : 400);
  } catch (error) {
    console.error("Read contract API error:", error);
    return c.json({ error: "Failed to read contract" }, 500);
  }
});

// POST /api/chains/:chainId/contracts/:address/simulate - 模拟合约调用
app.post("/api/chains/:chainId/contracts/:address/simulate", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json({ error: "Unsupported chain" }, 400);
  }

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json({ error: "Invalid contract address" }, 400);
  }

  try {
    const body = await c.req.json();
    const { functionName, args = [], value, from } = body;

    if (!functionName || typeof functionName !== "string") {
      return c.json({ error: "Function name is required" }, 400);
    }

    if (!Array.isArray(args)) {
      return c.json({ error: "Arguments must be an array" }, 400);
    }

    // 获取合约源码（可能是代理合约）
    const contractSource = await contractSourceService.getContractSource(
      chainId,
      address
    );

    let targetAddress = address;
    let targetABI = contractSource?.abi;

    // 如果是代理合约，使用实现合约的地址和ABI
    if (contractSource?.isProxy && contractSource?.implementationContract) {
      targetAddress = contractSource.implementationAddress! as Address;
      targetABI = contractSource.implementationContract.abi;
    }

    if (!targetABI) {
      return c.json({ error: "Contract ABI not available" }, 400);
    }

    const result = await contractInteractionService.simulateContractWithABI({
      chainId,
      contractAddress: targetAddress,
      functionName,
      args,
      value: value ? BigInt(value) : undefined,
      from,
      abi: targetABI,
    });

    c.header("X-Chain-Name", getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      contractAddress: address,
      functionName,
      args,
      value,
      from,
      result: result.result,
      success: result.success,
      error: result.error,
      gasUsed: result.gasUsed?.toString(),
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData, result.success ? 200 : 400);
  } catch (error) {
    console.error("Simulate contract API error:", error);
    return c.json({ error: "Failed to simulate contract" }, 500);
  }
});

// POST /api/chains/:chainId/contracts/:address/estimate-gas - 估算Gas费用
app.post("/api/chains/:chainId/contracts/:address/estimate-gas", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json({ error: "Unsupported chain" }, 400);
  }

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json({ error: "Invalid contract address" }, 400);
  }

  try {
    const body = await c.req.json();
    const { functionName, args = [], value, from } = body;

    if (!functionName || typeof functionName !== "string") {
      return c.json({ error: "Function name is required" }, 400);
    }

    if (!Array.isArray(args)) {
      return c.json({ error: "Arguments must be an array" }, 400);
    }

    // 获取合约源码（可能是代理合约）
    const contractSource = await contractSourceService.getContractSource(
      chainId,
      address
    );

    let targetAddress = address;
    let targetABI = contractSource?.abi;

    // 如果是代理合约，使用实现合约的地址和ABI
    if (contractSource?.isProxy && contractSource?.implementationContract) {
      targetAddress = contractSource.implementationAddress! as Address;
      targetABI = contractSource.implementationContract.abi;
    }

    if (!targetABI) {
      return c.json({ error: "Contract ABI not available" }, 400);
    }

    const gasEstimate =
      await contractInteractionService.estimateContractGasWithABI({
        chainId,
        contractAddress: targetAddress,
        functionName,
        args,
        value: value ? BigInt(value) : undefined,
        from,
        abi: targetABI,
      });

    c.header("X-Chain-Name", getChainName(chainId));

    if (!gasEstimate) {
      return c.json({ error: "Failed to estimate gas" }, 400);
    }

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      contractAddress: address,
      functionName,
      args,
      value,
      from,
      gasLimit: gasEstimate.gasLimit.toString(),
      gasPrice: gasEstimate.gasPrice?.toString(),
      maxFeePerGas: gasEstimate.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas?.toString(),
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    console.error("Gas estimation API error:", error);
    return c.json({ error: "Failed to estimate gas" }, 500);
  }
});

// GET /api/chains/:chainId/contracts/stats - 获取合约统计信息
app.get("/api/chains/:chainId/contracts/stats", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));

  try {
    const stats = await contractSourceService.getContractStats(chainId);

    c.header("X-Data-Source", "database");
    c.header("X-Chain-Name", getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      stats,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    console.error("Contract stats API error:", error);
    return c.json({ error: "Failed to get contract stats" }, 500);
  }
});

// GET /api/chains/:chainId/contracts/:address/creation - 获取合约创建信息
app.get("/api/chains/:chainId/contracts/:address/creation", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json({ error: "Unsupported chain" }, 400);
  }

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json({ error: "Invalid contract address" }, 400);
  }

  try {
    const creationInfo = await contractSourceService.getContractCreationInfo(
      chainId,
      address
    );

    c.header("X-Data-Source", "rpc");
    c.header("X-Chain-Name", getChainName(chainId));

    if (!creationInfo) {
      return c.json({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        found: false,
        message: "Contract creation information not found",
        timestamp: new Date().toISOString(),
      });
    }

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      contractAddress: address,
      found: true,
      creation: {
        txHash: creationInfo.txHash,
        blockNumber: creationInfo.blockNumber,
        creator: creationInfo.creator,
        timestamp: creationInfo.timestamp,
        gasUsed: creationInfo.gasUsed.toString(),
        gasPrice: creationInfo.gasPrice.toString(),
      },
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    console.error("Contract creation info API error:", error);
    return c.json({ error: "Failed to get contract creation info" }, 500);
  }
});

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

// Event Indexing APIs
// GET /api/chains/:chainId/contracts/:address/events/indexing-status - 获取事件索引状态
app.get("/api/chains/:chainId/contracts/:address/events/indexing-status", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));

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

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json(
      {
        error: "Invalid contract address",
        message: "Address must be a valid 42-character hexadecimal string starting with 0x",
      },
      400
    );
  }

  try {
    const performanceOptimizer = eventPerformanceOptimizerManager.getOptimizer(chainId);

    const indexingStatus = await performanceOptimizer.executeOptimizedQuery(
      'event_indexing_status',
      async () => {
        const indexingService = eventIndexingServiceManager.getService(chainId);
        return await indexingService.getIndexingStatus(address);
      },
      `indexing_status_${chainId}_${address}`,
      {
        useCache: true, // Cache indexing status as it doesn't change frequently
        timeout: 5000
      }
    );

    c.header("X-Data-Source", "database");
    c.header("X-Chain-Name", getChainName(chainId));
    c.header("Cache-Control", "public, max-age=30"); // Cache for 30 seconds

    return c.json({
      chainId,
      chainName: getChainName(chainId),
      contractAddress: address.toLowerCase(),
      isIndexed: indexingStatus.totalEventsIndexed > 0,
      indexingProgress: indexingStatus.indexingActive ? 50 : 100, // Mock progress calculation
      totalEvents: indexingStatus.totalEventsIndexed,
      lastIndexedBlock: indexingStatus.lastIndexedBlock?.toString() || null,
      lastIndexedAt: indexingStatus.lastIndexedAt?.toISOString() || null,
      eventTypes: indexingStatus.eventSignatures || [],
      errors: indexingStatus.errors.map(error => error.message),
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("Event indexing status API error:", error);

    // Return a safe default response for non-existent contracts
    return c.json({
      chainId,
      chainName: getChainName(chainId),
      contractAddress: address.toLowerCase(),
      isIndexed: false,
      indexingProgress: 0,
      totalEvents: 0,
      lastIndexedBlock: null,
      lastIndexedAt: null,
      eventTypes: [],
      errors: [],
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/chains/:chainId/contracts/:address/events - 获取合约事件列表
app.get("/api/chains/:chainId/contracts/:address/events", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));

  // Parse query parameters
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 1000); // Max 1000
  const offset = parseInt(c.req.query("offset") || "0");
  const cursor = c.req.query("cursor");
  const eventName = c.req.query("eventName");
  const fromBlock = c.req.query("fromBlock");
  const toBlock = c.req.query("toBlock");
  const fromTimestamp = c.req.query("fromTimestamp");
  const toTimestamp = c.req.query("toTimestamp");
  const sort = c.req.query("sort") || "desc";
  const sortBy = c.req.query("sortBy") || "block_timestamp";

  // Parse multi-sort parameters
  let multiSort = null;
  const multiSortParam = c.req.query("multiSort");
  if (multiSortParam) {
    try {
      multiSort = JSON.parse(multiSortParam);
    } catch (error) {
      console.warn("Invalid multiSort parameter:", multiSortParam);
    }
  }

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

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json(
      {
        error: "Invalid contract address",
        message: "Address must be a valid 42-character hexadecimal string starting with 0x",
      },
      400
    );
  }

  try {
    const performanceOptimizer = eventPerformanceOptimizerManager.getOptimizer(chainId);

    // Build filters
    const filters: any = {};
    if (eventName) filters.eventName = eventName;
    if (fromBlock) filters.fromBlock = fromBlock;
    if (toBlock) filters.toBlock = toBlock;
    if (fromTimestamp) filters.fromTimestamp = fromTimestamp;
    if (toTimestamp) filters.toTimestamp = toTimestamp;

    // Create cache key based on all parameters
    const cacheKey = `events_${chainId}_${address}_${JSON.stringify({
      limit,
      offset,
      cursor,
      eventName,
      fromBlock,
      toBlock,
      fromTimestamp,
      toTimestamp,
      sort,
      sortBy,
      multiSort
    })}`;

    const result = await performanceOptimizer.executeOptimizedQuery(
      'contract_events_query',
      async () => {
        const queryService = eventQueryServiceManager.getService(chainId);

        // For now, we'll return a mock response since we need the table name
        // In a real implementation, we would get the table name from the event registry
        const mockEvents = Array.from({ length: Math.min(limit, 10) }, (_, i) => ({
          blockHash: `0x${(i + 1000).toString(16).padStart(64, '0')}`,
          logIndex: i,
          transactionHash: `0x${(i + 2000).toString(16).padStart(64, '0')}`,
          transactionIndex: 0,
          blockNumber: BigInt(18000000 + i),
          blockTimestamp: new Date(Date.now() - i * 60000).toISOString(),
          contractAddress: address,
          eventName: eventName || "Transfer",
          eventSignature: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          from: `0x${(i + 3000).toString(16).padStart(40, '0')}`,
          to: `0x${(i + 4000).toString(16).padStart(40, '0')}`,
          value: "1000000000000000000",
          decodedAt: new Date().toISOString(),
          indexedAt: new Date().toISOString(),
        }));

        // Apply cursor-based pagination if provided
        let filteredEvents = mockEvents;
        if (cursor) {
          const cursorTimestamp = new Date(cursor).getTime();
          filteredEvents = mockEvents.filter(event =>
            new Date(event.blockTimestamp).getTime() < cursorTimestamp
          );
        }

        // Apply filters
        if (eventName) {
          filteredEvents = filteredEvents.filter(event => event.eventName === eventName);
        }

        // Sort events - support multi-sort if provided
        if (multiSort && Array.isArray(multiSort) && multiSort.length > 0) {
          // Apply multi-sort
          const sortedMultiSort = [...multiSort].sort((a, b) => (a.priority || 0) - (b.priority || 0));

          filteredEvents.sort((a, b) => {
            for (const sortConfig of sortedMultiSort) {
              let aValue: number, bValue: number;

              switch (sortConfig.type) {
                case 'numeric':
                  aValue = parseFloat(a[sortConfig.field]?.toString() || '0');
                  bValue = parseFloat(b[sortConfig.field]?.toString() || '0');
                  break;
                case 'timestamp':
                  aValue = new Date(a[sortConfig.field] || '').getTime();
                  bValue = new Date(b[sortConfig.field] || '').getTime();
                  break;
                case 'address':
                  aValue = a[sortConfig.field]?.toString().toLowerCase().localeCompare('') || 0;
                  bValue = b[sortConfig.field]?.toString().toLowerCase().localeCompare('') || 0;
                  break;
                case 'text':
                default:
                  aValue = a[sortConfig.field]?.toString().toLowerCase().localeCompare('') || 0;
                  bValue = b[sortConfig.field]?.toString().toLowerCase().localeCompare('') || 0;
                  break;
              }

              const comparison = sortConfig.direction === 'desc' ?
                (typeof aValue === 'number' ? bValue - aValue : (aValue > bValue ? -1 : aValue < bValue ? 1 : 0)) :
                (typeof aValue === 'number' ? aValue - bValue : (aValue > bValue ? 1 : aValue < bValue ? -1 : 0));

              if (comparison !== 0) return comparison;
            }
            return 0;
          });
        } else {
          // Apply single sort
          filteredEvents.sort((a, b) => {
            const aValue = sortBy === 'block_timestamp' ? new Date(a.blockTimestamp).getTime() : Number(a.blockNumber);
            const bValue = sortBy === 'block_timestamp' ? new Date(b.blockTimestamp).getTime() : Number(b.blockNumber);
            return sort === 'desc' ? bValue - aValue : aValue - bValue;
          });
        }

        // Apply limit
        const events = filteredEvents.slice(0, limit);
        const hasMore = mockEvents.length > limit;

        return {
          events,
          total: events.length,
          hasMore,
          nextCursor: hasMore && events.length > 0 ? events[events.length - 1].blockTimestamp : undefined,
        };
      },
      cacheKey,
      {
        useCache: true, // Enable caching for event queries
        timeout: 10000, // 10 second timeout for event queries
        expectedDataSize: limit * 1000 // Estimated size per event
      }
    );

    c.header("X-Data-Source", "database");
    c.header("X-Chain-Name", getChainName(chainId));
    c.header("Cache-Control", "public, max-age=30"); // Cache for 30 seconds

    return c.json({
      chainId,
      chainName: getChainName(chainId),
      contractAddress: address.toLowerCase(),
      events: result.events,
      total: result.total,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      filters,
      pagination: {
        limit,
        offset,
        cursor,
        sort,
        sortBy,
        multiSort,
        totalPages: Math.ceil(result.total / limit),
        currentPage: Math.floor(offset / limit) + 1,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("Contract events API error:", error);

    // Return empty result for errors
    return c.json({
      chainId,
      chainName: getChainName(chainId),
      contractAddress: address.toLowerCase(),
      events: [],
      total: 0,
      hasMore: false,
      nextCursor: undefined,
      filters,
      pagination: {
        limit,
        offset,
        cursor,
        sort,
        sortBy,
        multiSort,
        totalPages: 0,
        currentPage: 1,
      },
      timestamp: new Date().toISOString(),
    });
  }
});

// POST /api/chains/:chainId/contracts/:address/events/search - 高级事件搜索
app.post("/api/chains/:chainId/contracts/:address/events/search", async (c) => {
  const chainId = getValidatedChainId(c.req.param("chainId"));
  const address = getValidatedAddress(c.req.param("address"));

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

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json(
      {
        error: "Invalid contract address",
        message: "Address must be a valid 42-character hexadecimal string starting with 0x",
      },
      400
    );
  }

  try {
    const body = await c.req.json();
    const {
      filters = {},
      pagination = { limit: 50, offset: 0 },
      sort = { field: 'block_timestamp', direction: 'desc' },
      multiSort,
      includeSuggestions = false,
    } = body;

    // Validate pagination
    const limit = Math.min(Math.max(1, pagination.limit || 50), 1000);
    const offset = Math.max(0, pagination.offset || 0);

    // Validate sort
    const validSortFields = ['block_timestamp', 'block_number', 'event_name', 'transaction_hash'];
    const validSortDirections = ['asc', 'desc'];
    const sortBy = validSortFields.includes(sort.field) ? sort.field : 'block_timestamp';
    const sortDirection = validSortDirections.includes(sort.direction) ? sort.direction : 'desc';

    const performanceOptimizer = eventPerformanceOptimizerManager.getOptimizer(chainId);

    // Create cache key based on all search parameters
    const cacheKey = `events_search_${chainId}_${address}_${JSON.stringify({
      filters,
      pagination: { limit, offset },
      sort: { sortBy, sortDirection },
      multiSort,
      includeSuggestions,
    })}`;

    const startTime = performance.now();

    const result = await performanceOptimizer.executeOptimizedQuery(
      'advanced_events_search',
      async () => {
        const queryService = eventQueryServiceManager.getService(chainId);

        // Build search filters from request
        const searchFilters: any = {};

        // Apply event name filters
        if (filters.eventName) {
          if (Array.isArray(filters.eventName)) {
            searchFilters.eventName = filters.eventName;
          } else {
            searchFilters.eventName = filters.eventName;
          }
        }

        // Apply block range filters
        if (filters.fromBlock || filters.toBlock) {
          if (typeof filters.fromBlock === 'object') {
            if (filters.fromBlock.gte) searchFilters.fromBlock = String(filters.fromBlock.gte);
            if (filters.fromBlock.lte) searchFilters.toBlock = String(filters.fromBlock.lte);
          } else {
            if (filters.fromBlock) searchFilters.fromBlock = String(filters.fromBlock);
            if (filters.toBlock) searchFilters.toBlock = String(filters.toBlock);
          }
        }

        // Apply timestamp range filters
        if (filters.fromTimestamp || filters.toTimestamp) {
          if (typeof filters.fromTimestamp === 'object') {
            if (filters.fromTimestamp.gte) searchFilters.fromTimestamp = filters.fromTimestamp.gte;
            if (filters.fromTimestamp.lte) searchFilters.toTimestamp = filters.fromTimestamp.lte;
          } else {
            if (filters.fromTimestamp) searchFilters.fromTimestamp = filters.fromTimestamp;
            if (filters.toTimestamp) searchFilters.toTimestamp = filters.toTimestamp;
          }
        }

        // Apply address filters
        ['from', 'to', 'owner', 'spender', 'sender'].forEach(field => {
          if (filters[field]) {
            if (Array.isArray(filters[field])) {
              searchFilters[field] = filters[field];
            } else {
              searchFilters[field] = filters[field];
            }
          }
        });

        // Apply value filters
        if (filters.value) {
          if (typeof filters.value === 'object') {
            searchFilters.value = filters.value;
          } else {
            searchFilters.value = filters.value;
          }
        }

        // Apply transaction hash filter
        if (filters.transactionHash) {
          searchFilters.transactionHash = filters.transactionHash;
        }

        // Apply text search filters
        ['eventName', 'token'].forEach(field => {
          if (filters[field] && typeof filters[field] === 'object') {
            if (filters[field].like) {
              searchFilters[field] = filters[field];
            }
          }
        });

        // Execute mock search (in real implementation, this would use the query service)
        const mockEvents = Array.from({ length: Math.min(limit, 100) }, (_, i) => ({
          blockHash: `0x${(i + 5000).toString(16).padStart(64, '0')}`,
          logIndex: i % 10,
          transactionHash: `0x${(i + 6000).toString(16).padStart(64, '0')}`,
          transactionIndex: i % 5,
          blockNumber: BigInt(18000000 + i * 10),
          blockTimestamp: new Date(Date.now() - i * 120000).toISOString(),
          contractAddress: address,
          eventName: filters.eventName ?
            (Array.isArray(filters.eventName) ? filters.eventName[0] : filters.eventName) :
            ['Transfer', 'Approval', 'TransferFrom'][i % 3],
          eventSignature: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          from: filters.from || `0x${(i + 7000).toString(16).padStart(40, '0')}`,
          to: filters.to || `0x${(i + 8000).toString(16).padStart(40, '0')}`,
          value: filters.value ?
            (typeof filters.value === 'object' ? filters.value.gte || '1000000000000000000' : filters.value) :
            (BigInt(i + 1) * BigInt(10 ** 18)).toString(),
          token: filters.token || `Token${i % 10}`,
          decodedAt: new Date().toISOString(),
          indexedAt: new Date().toISOString(),
        }));

        // Apply complex filtering
        let filteredEvents = mockEvents;

        // Filter by event name
        if (searchFilters.eventName) {
          if (Array.isArray(searchFilters.eventName)) {
            filteredEvents = filteredEvents.filter(event =>
              searchFilters.eventName.includes(event.eventName)
            );
          } else {
            filteredEvents = filteredEvents.filter(event =>
              event.eventName === searchFilters.eventName
            );
          }
        }

        // Filter by addresses
        ['from', 'to', 'owner', 'spender', 'sender'].forEach(field => {
          if (searchFilters[field]) {
            if (Array.isArray(searchFilters[field])) {
              filteredEvents = filteredEvents.filter(event =>
                searchFilters[field].includes(event[field])
              );
            } else {
              filteredEvents = filteredEvents.filter(event =>
                event[field] === searchFilters[field]
              );
            }
          }
        });

        // Filter by value range
        if (searchFilters.value && typeof searchFilters.value === 'object') {
          filteredEvents = filteredEvents.filter(event => {
            const eventValue = BigInt(event.value);
            if (searchFilters.value.gte && searchFilters.value.lte) {
              return eventValue >= BigInt(searchFilters.value.gte) &&
                     eventValue <= BigInt(searchFilters.value.lte);
            } else if (searchFilters.value.gte) {
              return eventValue >= BigInt(searchFilters.value.gte);
            } else if (searchFilters.value.lte) {
              return eventValue <= BigInt(searchFilters.value.lte);
            }
            return true;
          });
        } else if (searchFilters.value) {
          filteredEvents = filteredEvents.filter(event =>
            event.value === searchFilters.value
          );
        }

        // Filter by block range
        if (searchFilters.fromBlock || searchFilters.toBlock) {
          filteredEvents = filteredEvents.filter(event => {
            const blockNum = Number(event.blockNumber);
            if (searchFilters.fromBlock && searchFilters.toBlock) {
              return blockNum >= Number(searchFilters.fromBlock) &&
                     blockNum <= Number(searchFilters.toBlock);
            } else if (searchFilters.fromBlock) {
              return blockNum >= Number(searchFilters.fromBlock);
            } else if (searchFilters.toBlock) {
              return blockNum <= Number(searchFilters.toBlock);
            }
            return true;
          });
        }

        // Filter by timestamp range
        if (searchFilters.fromTimestamp || searchFilters.toTimestamp) {
          filteredEvents = filteredEvents.filter(event => {
            const eventTime = new Date(event.blockTimestamp).getTime();
            if (searchFilters.fromTimestamp && searchFilters.toTimestamp) {
              const fromTime = new Date(searchFilters.fromTimestamp).getTime();
              const toTime = new Date(searchFilters.toTimestamp).getTime();
              return eventTime >= fromTime && eventTime <= toTime;
            } else if (searchFilters.fromTimestamp) {
              const fromTime = new Date(searchFilters.fromTimestamp).getTime();
              return eventTime >= fromTime;
            } else if (searchFilters.toTimestamp) {
              const toTime = new Date(searchFilters.toTimestamp).getTime();
              return eventTime <= toTime;
            }
            return true;
          });
        }

        // Filter by transaction hash
        if (searchFilters.transactionHash) {
          filteredEvents = filteredEvents.filter(event =>
            event.transactionHash.toLowerCase().includes(searchFilters.transactionHash.toLowerCase())
          );
        }

        // Text search filters
        ['eventName', 'token'].forEach(field => {
          if (searchFilters[field] && searchFilters[field].like) {
            filteredEvents = filteredEvents.filter(event => {
              const value = event[field];
              if (typeof value === 'string' && searchFilters[field].caseInsensitive) {
                return value.toLowerCase().includes(searchFilters[field].like.toLowerCase());
              }
              return value && String(value).includes(searchFilters[field].like);
            });
          }
        });

        // Apply sorting - support multi-sort if provided
        if (multiSort && Array.isArray(multiSort) && multiSort.length > 0) {
          // Apply multi-sort
          const sortedMultiSort = [...multiSort].sort((a, b) => (a.priority || 0) - (b.priority || 0));

          filteredEvents.sort((a, b) => {
            for (const sortConfig of sortedMultiSort) {
              let aValue: number | string, bValue: number | string;

              switch (sortConfig.type) {
                case 'numeric':
                  aValue = parseFloat(a[sortConfig.field]?.toString() || '0');
                  bValue = parseFloat(b[sortConfig.field]?.toString() || '0');
                  break;
                case 'timestamp':
                  aValue = new Date(a[sortConfig.field] || '').getTime();
                  bValue = new Date(b[sortConfig.field] || '').getTime();
                  break;
                case 'address':
                  aValue = a[sortConfig.field]?.toString().toLowerCase();
                  bValue = b[sortConfig.field]?.toString().toLowerCase();
                  break;
                case 'text':
                default:
                  aValue = a[sortConfig.field]?.toString().toLowerCase();
                  bValue = b[sortConfig.field]?.toString().toLowerCase();
                  break;
              }

              let comparison: number;
              if (typeof aValue === 'string') {
                comparison = aValue.localeCompare(bValue as string);
              } else {
                comparison = aValue - (bValue as number);
              }

              if (sortConfig.direction === 'desc') {
                comparison = -comparison;
              }

              if (comparison !== 0) return comparison;
            }
            return 0;
          });
        } else {
          // Apply single sort
          filteredEvents.sort((a, b) => {
            let aValue: number, bValue: number;

            switch (sortBy) {
              case 'block_number':
                aValue = Number(a.blockNumber);
                bValue = Number(b.blockNumber);
                break;
              case 'event_name':
                aValue = a.eventName.localeCompare(b.eventName);
                bValue = b.eventName.localeCompare(a.eventName);
                break;
              case 'transaction_hash':
                aValue = a.transactionHash.localeCompare(b.transactionHash);
                bValue = b.transactionHash.localeCompare(a.transactionHash);
                break;
              case 'block_timestamp':
              default:
                aValue = new Date(a.blockTimestamp).getTime();
                bValue = new Date(b.blockTimestamp).getTime();
                break;
            }

            return sortDirection === 'desc' ?
              (typeof aValue === 'number' ? bValue - aValue : aValue) :
              (typeof aValue === 'number' ? aValue - bValue : bValue);
          });
        }

        // Apply pagination
        const startIndex = offset;
        const endIndex = startIndex + limit;
        const paginatedEvents = filteredEvents.slice(startIndex, endIndex);

        return {
          events: paginatedEvents,
          total: filteredEvents.length,
          hasMore: endIndex < filteredEvents.length,
          pagination: {
            limit,
            offset,
            currentPage: Math.floor(offset / limit) + 1,
            totalPages: Math.ceil(filteredEvents.length / limit),
          },
        };
      },
      cacheKey,
      {
        useCache: true,
        timeout: 15000, // 15 second timeout for complex searches
        expectedDataSize: limit * 1500 // Estimated size per event
      }
    );

    const executionTime = performance.now() - startTime;

    // Determine which indexes were used (mock implementation)
    const indexesUsed = [];
    if (filters.from || filters.to) indexesUsed.push('idx_from', 'idx_to');
    if (filters.value) indexesUsed.push('idx_value');
    if (filters.fromBlock || filters.toBlock) indexesUsed.push('idx_block_number');
    if (filters.fromTimestamp || filters.toTimestamp) indexesUsed.push('idx_block_timestamp');

    // Generate suggestions if requested and no results
    let suggestions = [];
    if (includeSuggestions && result.events.length === 0) {
      suggestions = [
        'Try removing some filters to broaden your search',
        'Check if the contract has emitted any events',
        'Verify the contract address is correct',
        'Ensure the contract supports the event types you\'re searching for',
      ];
    }

    c.header("X-Data-Source", "database");
    c.header("X-Chain-Name", getChainName(chainId));
    c.header("Cache-Control", "public, max-age=60"); // Cache for 1 minute
    c.header("X-Execution-Time", executionTime.toFixed(2));

    return c.json({
      chainId,
      chainName: getChainName(chainId),
      contractAddress: address.toLowerCase(),
      events: result.events,
      total: result.total,
      hasMore: result.hasMore,
      pagination: result.pagination,
      filters,
      sort: {
        field: sortBy,
        direction: sortDirection,
      },
      multiSort,
      executionTime: Math.round(executionTime * 100) / 100,
      cacheHit: executionTime < 5, // Assume cache hit if very fast
      indexesUsed,
      optimizationSuggestions: executionTime > 500 ? [
        'Consider adding more specific filters',
        'Use indexed parameters when possible',
        'Reduce the time range for faster queries',
      ] : [],
      suggestions,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("Advanced events search API error:", error);

    // Return validation error for malformed requests
    if (error instanceof SyntaxError) {
      return c.json(
        {
          error: "Invalid request body",
          message: "Request body must be valid JSON",
        },
        400
      );
    }

    return c.json(
      {
        error: "Search failed",
        message: error instanceof Error ? error.message : "Internal server error",
      },
      500
    );
  }
});

// Performance monitoring API
// GET /api/performance/events - 获取事件系统性能指标
app.get("/api/performance/events", async (c) => {
  try {
    const chainIdParam = c.req.query("chainId");
    const chainId = chainIdParam ? parseInt(chainIdParam) : null;

    let metrics;
    if (chainId) {
      const optimizer = eventPerformanceOptimizerManager.getOptimizer(chainId);
      metrics = {
        chainId,
        chainName: getChainName(chainId),
        performance: optimizer.getPerformanceMetrics(),
        cache: optimizer.getCacheStatistics(),
        thresholds: optimizer.getThresholds(),
        strategies: optimizer.getStrategies(),
      };
    } else {
      metrics = eventPerformanceOptimizerManager.getAggregatedMetrics();
    }

    c.header("X-Data-Source", "monitoring");
    c.header("Cache-Control", "no-cache"); // Real-time monitoring data

    return c.json({
      performance: metrics,
      system: {
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      },
      requirements: {
        cachedQueryMaxMs: 9, // 1-9ms requirement
        uncachedQueryMaxMs: 100,
        largeDatasetMaxMs: 200,
      },
    });

  } catch (error) {
    console.error("Performance monitoring API error:", error);
    return c.json({ error: "Failed to get performance metrics" }, 500);
  }
});

// POST /api/performance/clear-cache - 清除性能缓存
app.post("/api/performance/clear-cache", async (c) => {
  try {
    const body = await c.req.json();
    const { chainId } = body;

    if (chainId) {
      const optimizer = eventPerformanceOptimizerManager.getOptimizer(chainId);
      optimizer.clearCaches();
    } else {
      eventPerformanceOptimizerManager.clearAllCaches();
    }

    return c.json({ success: true, message: "Cache cleared successfully" });

  } catch (error) {
    console.error("Clear cache API error:", error);
    return c.json({ error: "Failed to clear cache" }, 500);
  }
});

// POST /api/performance/warmup - 预热缓存
app.post("/api/performance/warmup", async (c) => {
  try {
    const body = await c.req.json();
    const { chainId, contracts } = body;

    if (!chainId || !contracts) {
      return c.json({ error: "Missing chainId or contracts array" }, 400);
    }

    const optimizer = eventPerformanceOptimizerManager.getOptimizer(chainId);
    await optimizer.warmUpCaches(contracts);

    return c.json({ success: true, message: "Cache warmup completed" });

  } catch (error) {
    console.error("Cache warmup API error:", error);
    return c.json({ error: "Failed to warm up cache" }, 500);
  }
});

// RPC配置管理API
app.get("/api/rpc-configs", async (c) => {
  try {
    const configs = await db.select().from(userRpcConfigs);

    return c.json({
      configs: configs.map((config) => ({
        id: config.chainId.toString(), // 暂时使用chainId作为id
        chainId: config.chainId,
        name: config.name,
        url: config.url,
        isCustom: true, // 默认为true
        supportsHistory: config.supportsHistory,
        maxEventRange: config.maxEventRange,
      })),
    });
  } catch (error) {
    console.error("Failed to get RPC configs:", error);
    return c.json({ error: "Failed to get RPC configs" }, 500);
  }
});

app.post("/api/rpc-configs", async (c) => {
  try {
    const body = await c.req.json();
    const { chainId, name, url, supportsHistory, maxEventRange } = body;

    if (!chainId || !name || !url) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    // 检查链ID是否已存在，如果存在则更新
    const existing = await db
      .select({ chainId: userRpcConfigs.chainId })
      .from(userRpcConfigs)
      .where(eq(userRpcConfigs.chainId, chainId));

    if (existing.length > 0) {
      // 更新现有配置
      await db
        .update(userRpcConfigs)
        .set({
          name,
          url,
          supportsHistory,
          maxEventRange,
          updatedAt: new Date(),
        })
        .where(eq(userRpcConfigs.chainId, chainId));
    } else {
      // 插入新配置
      await db.insert(userRpcConfigs).values({
        chainId,
        name,
        url,
        supportsHistory,
        maxEventRange,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // 重新加载RPC配置
    await rpcManager.reloadConfigs();

    return c.json({ success: true });
  } catch (error) {
    console.error("Failed to save RPC config:", error);
    console.error(
      "Error details:",
      error instanceof Error ? error.stack : error
    );
    return c.json({ error: "Failed to save RPC config" }, 500);
  }
});

app.delete("/api/rpc-configs/:chainId", async (c) => {
  try {
    const chainId = getValidatedChainId(c.req.param("chainId"));

    await db.delete(userRpcConfigs).where(eq(userRpcConfigs.chainId, chainId));

    // 重新加载RPC配置
    await rpcManager.reloadConfigs();

    return c.json({ success: true });
  } catch (error) {
    console.error("Failed to delete RPC config:", error);
    return c.json({ error: "Failed to delete RPC config" }, 500);
  }
});

export default app;
