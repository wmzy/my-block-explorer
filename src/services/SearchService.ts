import { db } from "../database/init";
import { blockService, type Block } from "./BlockService";
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

/**
 * 搜索服务
 * 负责统一的区块链数据搜索功能
 */
export class SearchService {
  // 主搜索入口
  async search(chainId: number, query: string): Promise<SearchResult> {
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
      // 记录搜索历史
      await this.recordSearch(chainId, trimmedQuery);

      // 检测查询类型并搜索
      const searchType = this.detectSearchType(trimmedQuery);

      switch (searchType) {
        case "block":
          return await this.searchBlock(chainId, trimmedQuery);
        case "transaction":
          return await this.searchTransaction(chainId, trimmedQuery);
        case "address":
          return await this.searchAddress(chainId, trimmedQuery);
        default:
          return await this.searchAll(chainId, trimmedQuery);
      }
    } catch (error) {
      console.error(`Search failed for query "${trimmedQuery}":`, error);
      return {
        type: "unknown",
        query: trimmedQuery,
        chainId,
        found: false,
        error: error instanceof Error ? error.message : "Search failed",
      };
    }
  }

  // 检测搜索类型
  private detectSearchType(query: string): SearchResultType {
    // 区块号（纯数字）
    if (/^\d+$/.test(query)) {
      return "block";
    }

    // 交易哈希（0x开头，64个字符）
    if (/^0x[a-fA-F0-9]{64}$/.test(query)) {
      return "transaction";
    }

    // 区块哈希（0x开头，64个字符，与交易哈希格式相同，但通过上下文区分）
    if (/^0x[a-fA-F0-9]{64}$/.test(query)) {
      // 这里可能是区块哈希或交易哈希，需要都尝试
      return "transaction"; // 优先尝试交易
    }

    // 地址（0x开头，40个字符）
    if (/^0x[a-fA-F0-9]{40}$/.test(query)) {
      return "address";
    }

    // ENS域名或其他
    if (query.includes(".")) {
      return "address"; // 可能是ENS域名
    }

    return "unknown";
  }

  // 搜索区块
  private async searchBlock(
    chainId: number,
    query: string
  ): Promise<SearchResult> {
    try {
      let block: Block | null = null;

      // 如果是数字，按区块号搜索
      if (/^\d+$/.test(query)) {
        const blockNumber = BigInt(query);
        block = await blockService.getBlockByNumber(chainId, blockNumber);
      }
      // 如果是哈希，按哈希搜索
      else if (/^0x[a-fA-F0-9]{64}$/.test(query)) {
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
        suggestions: await this.getBlockSuggestions(chainId),
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
  }

  // 搜索交易
  private async searchTransaction(
    chainId: number,
    query: string
  ): Promise<SearchResult> {
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

      // 如果没找到交易，可能是区块哈希
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
        suggestions: await this.getTransactionSuggestions(chainId),
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
  }

  // 搜索地址
  private async searchAddress(
    chainId: number,
    query: string
  ): Promise<SearchResult> {
    try {
      // TODO: 如果是ENS域名，需要解析为地址
      let address = query;

      // 简单的地址格式验证
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return {
          type: "address",
          query,
          chainId,
          found: false,
          error: "Invalid address format",
        };
      }

      const addressInfo = await addressService.getAddressInfo(chainId, address);

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
  }

  // 搜索所有类型
  private async searchAll(
    chainId: number,
    query: string
  ): Promise<SearchResult> {
    // 尝试各种类型的搜索
    const searches = [
      this.searchBlock(chainId, query),
      this.searchTransaction(chainId, query),
      this.searchAddress(chainId, query),
    ];

    const results = await Promise.allSettled(searches);

    // 找到第一个成功的结果
    for (const result of results) {
      if (result.status === "fulfilled" && result.value.found) {
        return result.value;
      }
    }

    // 如果都没找到，返回综合建议
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
  }

  // 获取区块建议
  private async getBlockSuggestions(chainId: number): Promise<string[]> {
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
  }

  // 获取交易建议
  private async getTransactionSuggestions(chainId: number): Promise<string[]> {
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
  }

  // 记录搜索历史
  private async recordSearch(
    chainId: number,
    query: string,
    resultType?: SearchResultType,
    resultId?: string
  ): Promise<void> {
    try {
      await db.query(
        `
        INSERT INTO search_history (chain_id, query, result_type, result_id, searched_at)
        VALUES (?, ?, ?, ?, ?)
      `,
        [
          chainId,
          query,
          resultType || null,
          resultId || null,
          new Date().toISOString(),
        ]
      );
    } catch (error) {
      console.warn("Failed to record search history:", error);
    }
  }

  // 获取搜索历史
  async getSearchHistory(
    chainId: number,
    limit: number = 20
  ): Promise<
    {
      query: string;
      resultType?: string;
      searchedAt: Date;
    }[]
  > {
    try {
      const result = await db.query<{
        query: string;
        result_type: string;
        searched_at: string;
      }>(
        `
        SELECT query, result_type, searched_at 
        FROM search_history 
        WHERE chain_id = ?
        ORDER BY searched_at DESC 
        LIMIT ?
      `,
        [chainId, limit]
      );

      return result.map((row) => ({
        query: row.query,
        resultType: row.result_type || undefined,
        searchedAt: new Date(row.searched_at),
      }));
    } catch (error) {
      console.error("Failed to get search history:", error);
      return [];
    }
  }

  // 获取热门搜索
  async getPopularSearches(
    chainId: number,
    limit: number = 10
  ): Promise<
    {
      query: string;
      count: number;
    }[]
  > {
    try {
      const result = await db.query<{
        query: string;
        count: number;
      }>(
        `
        SELECT query, COUNT(*) as count 
        FROM search_history 
        WHERE chain_id = ? AND searched_at > datetime('now', '-7 days')
        GROUP BY query 
        ORDER BY count DESC 
        LIMIT ?
      `,
        [chainId, limit]
      );

      return result;
    } catch (error) {
      console.error("Failed to get popular searches:", error);
      return [];
    }
  }

  // 清理旧的搜索历史
  async cleanupSearchHistory(olderThanDays: number = 30): Promise<void> {
    try {
      await db.query(`
        DELETE FROM search_history 
        WHERE searched_at < datetime('now', '-${olderThanDays} days')
      `);
    } catch (error) {
      console.error("Failed to cleanup search history:", error);
    }
  }
}

// 导出全局实例
export const searchService = new SearchService();
