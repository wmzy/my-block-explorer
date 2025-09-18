// API客户端
import type {
  Block,
  Transaction,
  AddressInfo,
  PaginationParams,
  ListResponse,
} from "@/shared/types/index";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ApiClient {
  private baseUrl: string;
  private defaultTimeout: number;

  constructor(baseUrl = "", timeout = 10000) {
    this.baseUrl = baseUrl;
    this.defaultTimeout = timeout;
  }

  // 基础请求方法
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<{ data: T; headers: Headers }> {
    const url = `${this.baseUrl}${endpoint}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.defaultTimeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await responseon().catch(() => ({}));
        throw new ApiError(
          errorData.message || `HTTP ${response.status}`,
          response.status,
          errorData.code,
          errorData.details
        );
      }

      const data = await responseon();
      return { data, headers: response.headers };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof ApiError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new ApiError("Request timeout", 408);
        }
        throw new ApiError(error.message, 0);
      }

      throw new ApiError("Unknown error", 0);
    }
  }

  // GET请求
  private async get<T>(
    endpoint: string
  ): Promise<{ data: T; headers: Headers }> {
    return this.request<T>(endpoint, { method: "GET" });
  }

  // POST请求
  private async post<T>(
    endpoint: string,
    body?: any
  ): Promise<{ data: T; headers: Headers }> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  // PUT请求
  private async put<T>(
    endpoint: string,
    body?: any
  ): Promise<{ data: T; headers: Headers }> {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  // DELETE请求
  private async delete<T>(
    endpoint: string
  ): Promise<{ data: T; headers: Headers }> {
    return this.request<T>(endpoint, { method: "DELETE" });
  }

  // 区块相关API
  async getLatestBlocks(
    chainId: number,
    params?: PaginationParams
  ): Promise<ListResponse<Block>> {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", params.page.toString());
    if (params?.limit) query.set("limit", params.limit.toString());

    const { data } = await this.get<ListResponse<Block>>(
      `/api/chains/${chainId}/blocks?${query}`
    );
    return data;
  }

  async getBlockByNumber(chainId: number, blockNumber: number): Promise<Block> {
    const { data } = await this.get<Block>(
      `/api/chains/${chainId}/blocks/${blockNumber}`
    );
    return data;
  }

  async getBlockByHash(chainId: number, blockHash: string): Promise<Block> {
    const { data } = await this.get<Block>(
      `/api/chains/${chainId}/blocks/hash/${blockHash}`
    );
    return data;
  }

  async getBlocksInRange(
    chainId: number,
    fromBlock?: number,
    toBlock?: number,
    params?: PaginationParams
  ): Promise<ListResponse<Block>> {
    const query = new URLSearchParams();
    if (fromBlock !== undefined) query.set("fromBlock", fromBlock.toString());
    if (toBlock !== undefined) query.set("toBlock", toBlock.toString());
    if (params?.page) query.set("page", params.page.toString());
    if (params?.limit) query.set("limit", params.limit.toString());

    const { data } = await this.get<ListResponse<Block>>(
      `/api/chains/${chainId}/blocks/range?${query}`
    );
    return data;
  }

  async getLatestBlockNumber(chainId: number): Promise<number> {
    const { data } = await this.get<{ blockNumber: number }>(
      `/api/chains/${chainId}/blocks/latest/number`
    );
    return data.blockNumber;
  }

  async getBlockStats(chainId: number): Promise<any> {
    const { data } = await this.get(`/api/chains/${chainId}/blocks/stats`);
    return data;
  }

  // 交易相关API
  async getTransactionByHash(
    chainId: number,
    txHash: string
  ): Promise<Transaction> {
    const { data } = await this.get<Transaction>(
      `/api/chains/${chainId}/transactions/${txHash}`
    );
    return data;
  }

  async getLatestTransactions(
    chainId: number,
    params?: PaginationParams
  ): Promise<ListResponse<Transaction>> {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", params.page.toString());
    if (params?.limit) query.set("limit", params.limit.toString());

    const { data } = await this.get<ListResponse<Transaction>>(
      `/api/chains/${chainId}/transactions?${query}`
    );
    return data;
  }

  async getTransactionsByBlock(
    chainId: number,
    blockNumber: number,
    params?: PaginationParams
  ): Promise<ListResponse<Transaction>> {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", params.page.toString());
    if (params?.limit) query.set("limit", params.limit.toString());

    const { data } = await this.get<ListResponse<Transaction>>(
      `/api/chains/${chainId}/blocks/${blockNumber}/transactions?${query}`
    );
    return data;
  }

  async getTransactionsByAddress(
    chainId: number,
    address: string,
    params?: PaginationParams
  ): Promise<ListResponse<Transaction>> {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", params.page.toString());
    if (params?.limit) query.set("limit", params.limit.toString());

    const { data } = await this.get<ListResponse<Transaction>>(
      `/api/chains/${chainId}/addresses/${address}/transactions?${query}`
    );
    return data;
  }

  async getAddressTransactionHistory(
    chainId: number,
    address: string,
    fromBlock?: number,
    toBlock?: number
  ): Promise<{
    data: Transaction[];
    isComplete: boolean;
    suggestion?: string;
  }> {
    const query = new URLSearchParams();
    if (fromBlock !== undefined) query.set("fromBlock", fromBlock.toString());
    if (toBlock !== undefined) query.set("toBlock", toBlock.toString());

    const { data } = await this.get<{
      data: Transaction[];
      isComplete: boolean;
      suggestion?: string;
    }>(
      `/api/chains/${chainId}/addresses/${address}/transactions/history?${query}`
    );
    return data;
  }

  async getTransactionStats(chainId: number): Promise<any> {
    const { data } = await this.get(
      `/api/chains/${chainId}/transactions/stats`
    );
    return data;
  }

  // 地址相关API
  async getAddressInfo(chainId: number, address: string): Promise<AddressInfo> {
    const { data } = await this.get<AddressInfo>(
      `/api/chains/${chainId}/addresses/${address}`
    );
    return data;
  }

  async getAddressBalance(chainId: number, address: string): Promise<string> {
    const { data } = await this.get<{ balance: string }>(
      `/api/chains/${chainId}/addresses/${address}/balance`
    );
    return data.balance;
  }

  async getAddressBalanceAtBlock(
    chainId: number,
    address: string,
    blockNumber: number
  ): Promise<string> {
    const { data } = await this.get<{ balance: string }>(
      `/api/chains/${chainId}/addresses/${address}/balance/${blockNumber}`
    );
    return data.balance;
  }

  async isContract(chainId: number, address: string): Promise<boolean> {
    const { data } = await this.get<{ isContract: boolean }>(
      `/api/chains/${chainId}/addresses/${address}/contract`
    );
    return data.isContract;
  }

  async setAddressLabel(
    chainId: number,
    address: string,
    label: string
  ): Promise<void> {
    await this.post(`/api/chains/${chainId}/addresses/${address}/label`, {
      label,
    });
  }

  async getAddressLabel(
    chainId: number,
    address: string
  ): Promise<string | null> {
    const { data } = await this.get<{ label: string | null }>(
      `/api/chains/${chainId}/addresses/${address}/label`
    );
    return data.label;
  }

  async removeAddressLabel(chainId: number, address: string): Promise<void> {
    await this.delete(`/api/chains/${chainId}/addresses/${address}/label`);
  }

  // 搜索相关API
  async search(query: string, chainId?: number): Promise<any> {
    const searchParams = new URLSearchParams({ q: query });
    if (chainId) searchParams.set("chainId", chainId.toString());

    const { data } = await this.get(`/api/search?${searchParams}`);
    return data;
  }

  async searchInChain(chainId: number, query: string): Promise<any> {
    const { data } = await this.get(
      `/api/chains/${chainId}/search?q=${encodeURIComponent(query)}`
    );
    return data;
  }

  // 统计相关API
  async getChainStats(chainId: number): Promise<any> {
    const { data } = await this.get(`/api/chains/${chainId}/stats`);
    return data;
  }

  async getOverviewStats(): Promise<any> {
    const { data } = await this.get("/api/stats/overview");
    return data;
  }

  async getChainStatus(chainId: number): Promise<any> {
    const { data } = await this.get(`/api/chains/${chainId}/status`);
    return data;
  }

  async getHealth(): Promise<any> {
    const { data } = await this.get("/api/health");
    return data;
  }

  // 设置基础URL（用于自动发现）
  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }

  // 获取当前基础URL
  getBaseUrl(): string {
    return this.baseUrl;
  }
}

// 默认API客户端实例
export const apiClient = new ApiClient();
