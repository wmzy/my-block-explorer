import { db, searchHistory } from "../database/init";
import { sql, desc } from "drizzle-orm";
import { createLogger } from "../server/logger";
import { blockService, type Block } from "./BlockService";

const logger = createLogger("search-service");
import { transactionService, type Transaction } from "./TransactionService";
import { addressService, type AddressInfo } from "./AddressService";

/**
 * 搜索结果类型
 */
export type SearchResultType = "block" | "transaction" | "address" | "unknown";

export type SearchResult = {
  type: SearchResultType;
  query: string;
  chainId: number;
  found: boolean;
  data?: Block | Transaction | AddressInfo;
  suggestions?: string[];
  error?: string;
};

type SearchServiceDeps = {
  db: typeof import("../database/init").db;
  searchHistory: typeof import("../database/init").searchHistory;
  blockService: typeof import("./BlockService").blockService;
  transactionService: typeof import("./TransactionService").transactionService;
  addressService: typeof import("./AddressService").addressService;
};

const createSearchService = (deps: SearchServiceDeps) => {
  const { db, searchHistory, blockService, transactionService, addressService } = deps;

  const detectSearchType = (query: string): SearchResultType => {
    if (/^\d+$/.test(query)) {
      return "block";
    }

    if (/^0x[a-fA-F0-9]{64}$/.test(query)) {
      return "transaction";
    }

    if (/^0x[a-fA-F0-9]{40}$/.test(query)) {
      return "address";
    }

    if (query.includes(".")) {
      return "address";
    }

    return "unknown";
  };

  const getBlockSuggestions = async (chainId: number): Promise<string[]> => {
    try {
      const latestBlock = await blockService.getLatestBlock(chainId);
      const suggestions = ["请输入有效的区块号或区块哈希"];

      if (latestBlock) {
        suggestions.push(`最新区块号：${latestBlock.number.toString()}`);
        suggestions.push(`最新区块哈希：${latestBlock.hash}`);
      }

      return suggestions;
    } catch (error) {
      return ["请输入有效的区块号或区块哈希"];
    }
  };

  const getTransactionSuggestions = async (chainId: number): Promise<string[]> => {
    try {
      const recentTxs = await transactionService.getLatestTransactions(
        chainId,
        3
      );
      const suggestions = ["请输入有效的交易哈希（0x开头的64位字符串）"];

      if (recentTxs.length > 0) {
        suggestions.push("最近的交易：");
        recentTxs.forEach((tx) => {
          suggestions.push(`${tx.hash}`);
        });
      }

      return suggestions;
    } catch (error) {
      return ["请输入有效的交易哈希（0x开头的64位字符串）"];
    }
  };

  const recordSearch = async (
    chainId: number,
    query: string,
    resultType?: SearchResultType,
  ): Promise<void> => {
    try {
      await db.insert(searchHistory).values({
        query,
        searchType: resultType ?? null,
        resultCount: 0,
      } as any);
    } catch (error) {
      logger.warn({ err: error }, "Failed to record search history");
    }
  };

  const searchBlock = async (
    chainId: number,
    query: string
  ): Promise<SearchResult> => {
    try {
      let block: Block | null = null;

      if (/^\d+$/.test(query)) {
        const blockNumber = BigInt(query);
        block = await blockService.getBlockByNumber(chainId, blockNumber);
      } else if (/^0x[a-fA-F0-9]{64}$/.test(query)) {
        block = await blockService.getBlockByHash(chainId, query);
      }

      if (block) {
        return {
          type: "block",
          query,
          chainId,
          found: true,
          data: block,
        };
      }

      return {
        type: "block",
        query,
        chainId,
        found: false,
        suggestions: await getBlockSuggestions(chainId),
      };
    } catch (error) {
      return {
        type: "block",
        query,
        chainId,
        found: false,
        error: error instanceof Error ? error.message : "Block search failed",
      };
    }
  };

  const searchTransaction = async (
    chainId: number,
    query: string
  ): Promise<SearchResult> => {
    try {
      const transaction = await transactionService.getTransactionByHash(
        chainId,
        query
      );

      if (transaction) {
        return {
          type: "transaction",
          query,
          chainId,
          found: true,
          data: transaction,
        };
      }

      if (/^0x[a-fA-F0-9]{64}$/.test(query)) {
        const block = await blockService.getBlockByHash(chainId, query);
        if (block) {
          return {
            type: "block",
            query,
            chainId,
            found: true,
            data: block,
          };
        }
      }

      return {
        type: "transaction",
        query,
        chainId,
        found: false,
        suggestions: await getTransactionSuggestions(chainId),
      };
    } catch (error) {
      return {
        type: "transaction",
        query,
        chainId,
        found: false,
        error:
          error instanceof Error ? error.message : "Transaction search failed",
      };
    }
  };

  const searchAddress = async (
    chainId: number,
    query: string
  ): Promise<SearchResult> => {
    try {
      let address = query;

      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return {
          type: "address",
          query,
          chainId,
          found: false,
          error: "Invalid address format",
        };
      }

      const addressInfo = await addressService.getAddressInfo(
        chainId,
        address as `0x${string}`
      );

      return {
        type: "address",
        query,
        chainId,
        found: true,
        data: addressInfo,
      };
    } catch (error) {
      return {
        type: "address",
        query,
        chainId,
        found: false,
        error: error instanceof Error ? error.message : "Address search failed",
      };
    }
  };

  const searchAll = async (
    chainId: number,
    query: string
  ): Promise<SearchResult> => {
    const searches = [
      searchBlock(chainId, query),
      searchTransaction(chainId, query),
      searchAddress(chainId, query),
    ];

    const results = await Promise.allSettled(searches);

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.found) {
        return result.value;
      }
    }

    return {
      type: "unknown",
      query,
      chainId,
      found: false,
      suggestions: [
        "请输入有效的区块号、交易哈希或地址",
        "区块号：纯数字（如 18000000）",
        "交易哈希：0x开头的64位十六进制字符串",
        "地址：0x开头的40位十六进制字符串",
        "区块哈希：0x开头的64位十六进制字符串",
      ],
    };
  };

  return {
    search: async (chainId: number, query: string): Promise<SearchResult> => {
      const trimmedQuery = query.trim();

      if (!trimmedQuery) {
        return {
          type: "unknown",
          query,
          chainId,
          found: false,
          error: "Empty search query",
        };
      }

      try {
        await recordSearch(chainId, trimmedQuery);

        const searchType = detectSearchType(trimmedQuery);

        switch (searchType) {
          case "block":
            return await searchBlock(chainId, trimmedQuery);
          case "transaction":
            return await searchTransaction(chainId, trimmedQuery);
          case "address":
            return await searchAddress(chainId, trimmedQuery);
          default:
            return await searchAll(chainId, trimmedQuery);
        }
      } catch (error) {
        logger.error({ err: error, query: trimmedQuery }, "Search failed");
        return {
          type: "unknown",
          query: trimmedQuery,
          chainId,
          found: false,
          error: error instanceof Error ? error.message : "Search failed",
        };
      }
    },

    getSearchHistory: async (
      _chainId: number,
      limit: number = 20
    ): Promise<
      {
        query: string;
        resultType?: string;
        searchedAt: Date;
      }[]
    > => {
      try {
        const result = await db
          .select({
            query: searchHistory.query,
            searchType: searchHistory.searchType,
            searchedAt: searchHistory.searchedAt,
          })
          .from(searchHistory)
          .orderBy(desc(searchHistory.searchedAt))
          .limit(limit);

        return result.map((row) => ({
          query: row.query ?? "",
          resultType: row.searchType ?? undefined,
          searchedAt: row.searchedAt ? new Date(row.searchedAt) : new Date(),
        }));
      } catch (error) {
        logger.error({ err: error }, "Failed to get search history");
        return [];
      }
    },

    getPopularSearches: async (
      _chainId: number,
      limit: number = 10
    ): Promise<
      {
        query: string;
        count: number;
      }[]
    > => {
      try {
        const result = await db.execute(
          sql`SELECT query, COUNT(*) as count
              FROM search_history
              WHERE searched_at > now() - INTERVAL '7 days'
              GROUP BY query
              ORDER BY count DESC
              LIMIT ${limit}`
        );

        return result as unknown as Array<{ query: string; count: number }>;
      } catch (error) {
        logger.error({ err: error }, "Failed to get popular searches");
        return [];
      }
    },

    cleanupSearchHistory: async (
      olderThanDays: number = 30
    ): Promise<void> => {
      try {
        await db.execute(
          sql`DELETE FROM search_history
              WHERE searched_at < now() - INTERVAL '${sql.raw(String(olderThanDays))} days'`
        );
      } catch (error) {
        logger.error({ err: error }, "Failed to cleanup search history");
      }
    },
  };
};

export type SearchService = ReturnType<typeof createSearchService>;
export { createSearchService };

export const searchService = createSearchService({
  db,
  searchHistory,
  blockService,
  transactionService,
  addressService,
});
