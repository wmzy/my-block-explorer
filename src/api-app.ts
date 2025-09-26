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
