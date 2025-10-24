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
      sortBy
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

        // Sort events
        filteredEvents.sort((a, b) => {
          const aValue = sortBy === 'block_timestamp' ? new Date(a.blockTimestamp).getTime() : Number(a.blockNumber);
          const bValue = sortBy === 'block_timestamp' ? new Date(b.blockTimestamp).getTime() : Number(b.blockNumber);
          return sort === 'desc' ? bValue - aValue : aValue - bValue;
        });

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
      },
      timestamp: new Date().toISOString(),
    });
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
