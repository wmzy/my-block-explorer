import type {
  Block,
  Transaction,
  AddressInfo,
} from "@/types/index";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown
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
        const errorData = await response.json().catch(() => ({}));
        throw new ApiError(
          errorData.message || `HTTP ${response.status}`,
          response.status,
          errorData.code,
          errorData.details
        );
      }

      const data = await response.json();
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

  private async get<T>(
    endpoint: string
  ): Promise<{ data: T; headers: Headers }> {
    return this.request<T>(endpoint, { method: "GET" });
  }

  private async post<T>(
    endpoint: string,
    body?: unknown
  ): Promise<{ data: T; headers: Headers }> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  private async del<T>(
    endpoint: string
  ): Promise<{ data: T; headers: Headers }> {
    return this.request<T>(endpoint, { method: "DELETE" });
  }

  // Block APIs — aligned with actual backend endpoints
  async getLatestBlock(chainId: number): Promise<Record<string, unknown>> {
    const { data } = await this.get<Record<string, unknown>>(
      `/api/chains/${chainId}/blocks/latest`
    );
    return data;
  }

  async getBlocks(
    chainId: number,
    limit = 20,
    offset = 0
  ): Promise<{ blocks: Block[]; total: number }> {
    const query = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });
    const { data } = await this.get<{ blocks: Block[]; total: number }>(
      `/api/chains/${chainId}/blocks?${query}`
    );
    return data;
  }

  async getBlockByNumber(chainId: number, blockNumber: number): Promise<Record<string, unknown>> {
    const { data } = await this.get<Record<string, unknown>>(
      `/api/chains/${chainId}/blocks/${blockNumber}`
    );
    return data;
  }

  // Transaction APIs
  async getTransactionByHash(
    chainId: number,
    txHash: string
  ): Promise<Record<string, unknown>> {
    const { data } = await this.get<Record<string, unknown>>(
      `/api/chains/${chainId}/transactions/${txHash}`
    );
    return data;
  }

  async getTransactions(
    chainId: number,
    limit = 20
  ): Promise<Record<string, unknown>> {
    const { data } = await this.get<Record<string, unknown>>(
      `/api/chains/${chainId}/transactions?limit=${limit}`
    );
    return data;
  }

  // Address APIs
  async getAddressInfo(chainId: number, address: string): Promise<AddressInfo> {
    const { data } = await this.get<AddressInfo>(
      `/api/chains/${chainId}/addresses/${address}`
    );
    return data;
  }

  async getAddressPersistent(chainId: number, address: string): Promise<Record<string, unknown>> {
    const { data } = await this.get<Record<string, unknown>>(
      `/api/chains/${chainId}/addresses/${address}/persistent`
    );
    return data;
  }

  async getAddressTransactions(
    chainId: number,
    address: string,
    limit = 20,
    offset = 0
  ): Promise<{ transactions: Transaction[]; total: number }> {
    const query = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });
    const { data } = await this.get<{ transactions: Transaction[]; total: number }>(
      `/api/chains/${chainId}/addresses/${address}/transactions?${query}`
    );
    return data;
  }

  // Search APIs
  async search(query: string): Promise<Record<string, unknown>> {
    const { data } = await this.get<Record<string, unknown>>(
      `/api/search?q=${encodeURIComponent(query)}`
    );
    return data;
  }

  async searchInChain(chainId: number, query: string): Promise<Record<string, unknown>> {
    const { data } = await this.get<Record<string, unknown>>(
      `/api/chains/${chainId}/search?q=${encodeURIComponent(query)}`
    );
    return data;
  }

  // Stats APIs
  async getOverviewStats(): Promise<Record<string, unknown>> {
    const { data } = await this.get<Record<string, unknown>>("/api/stats/overview");
    return data;
  }

  // Health
  async getHealth(): Promise<Record<string, unknown>> {
    const { data } = await this.get<Record<string, unknown>>("/api/health");
    return data;
  }

  // Contract APIs
  async getContractSource(chainId: number, address: string): Promise<Record<string, unknown>> {
    const { data } = await this.get<Record<string, unknown>>(
      `/api/chains/${chainId}/contracts/${address}/source`
    );
    return data;
  }

  async getContractAbi(chainId: number, address: string): Promise<Record<string, unknown>> {
    const { data } = await this.get<Record<string, unknown>>(
      `/api/chains/${chainId}/contracts/${address}/abi`
    );
    return data;
  }

  async getContractFunctions(chainId: number, address: string): Promise<Record<string, unknown>> {
    const { data } = await this.get<Record<string, unknown>>(
      `/api/chains/${chainId}/contracts/${address}/functions`
    );
    return data;
  }

  async readContract(
    chainId: number,
    address: string,
    functionName: string,
    args: unknown[] = []
  ): Promise<Record<string, unknown>> {
    const { data } = await this.post<Record<string, unknown>>(
      `/api/chains/${chainId}/contracts/${address}/read`,
      { functionName, args }
    );
    return data;
  }

  async getContractCreation(chainId: number, address: string): Promise<Record<string, unknown>> {
    const { data } = await this.get<Record<string, unknown>>(
      `/api/chains/${chainId}/contracts/${address}/creation`
    );
    return data;
  }

  // RPC config APIs
  async getRpcConfigs(): Promise<Record<string, unknown>> {
    const { data } = await this.get<Record<string, unknown>>("/api/rpc-configs");
    return data;
  }

  async saveRpcConfig(config: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data } = await this.post<Record<string, unknown>>("/api/rpc-configs", config);
    return data;
  }

  async deleteRpcConfig(chainId: number): Promise<Record<string, unknown>> {
    const { data } = await this.del<Record<string, unknown>>(`/api/rpc-configs/${chainId}`);
    return data;
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}

export const apiClient = new ApiClient();
