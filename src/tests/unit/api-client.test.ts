import { describe, it, expect, beforeEach, vi } from "vitest";
import { ApiClient, ApiError } from "@/api/client";

describe("ApiClient", () => {
  const mockFetch = vi.fn();
  const baseUrl = "http://localhost:8201";

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch;
  });

  describe("getHealth", () => {
    it("returns health data on success", async () => {
      const healthData = { status: "healthy", message: "API is running" };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(healthData),
        headers: new Headers(),
      });

      const client = new ApiClient(baseUrl);
      const result = await client.getHealth();

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/health`,
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
        })
      );
      expect(result).toEqual(healthData);
    });
  });

  describe("getBlocks", () => {
    it("sends correct query params (limit, offset)", async () => {
      const blocksData = { blocks: [], total: 0 };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(blocksData),
        headers: new Headers(),
      });

      const client = new ApiClient(baseUrl);
      await client.getBlocks(1, 10, 5);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/chains/1/blocks?limit=10&offset=5"),
        expect.any(Object)
      );
    });
  });

  describe("getBlockByNumber", () => {
    it("calls correct endpoint", async () => {
      const blockData = { number: 12345, hash: "0xabc" };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(blockData),
        headers: new Headers(),
      });

      const client = new ApiClient(baseUrl);
      const result = await client.getBlockByNumber(1, 12345);

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/chains/1/blocks/12345`,
        expect.any(Object)
      );
      expect(result).toEqual(blockData);
    });
  });

  describe("getTransactionByHash", () => {
    it("calls correct endpoint", async () => {
      const txData = { hash: "0xabc123" };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(txData),
        headers: new Headers(),
      });

      const client = new ApiClient(baseUrl);
      const result = await client.getTransactionByHash(1, "0xabc123");

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/chains/1/transactions/0xabc123`,
        expect.any(Object)
      );
      expect(result).toEqual(txData);
    });
  });

  describe("getAddressInfo", () => {
    it("calls correct endpoint", async () => {
      const addressData = { address: "0x123", balance: "0" };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(addressData),
        headers: new Headers(),
      });

      const client = new ApiClient(baseUrl);
      const result = await client.getAddressInfo(1, "0x123");

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/chains/1/addresses/0x123`,
        expect.any(Object)
      );
      expect(result).toEqual(addressData);
    });
  });

  describe("search", () => {
    it("encodes query parameter", async () => {
      const searchData = { results: [] };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(searchData),
        headers: new Headers(),
      });

      const client = new ApiClient(baseUrl);
      await client.search("test query & special=chars");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(
          encodeURIComponent("test query & special=chars")
        ),
        expect.any(Object)
      );
    });
  });

  describe("getOverviewStats", () => {
    it("calls correct endpoint", async () => {
      const statsData = { totalChains: 5 };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(statsData),
        headers: new Headers(),
      });

      const client = new ApiClient(baseUrl);
      const result = await client.getOverviewStats();

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/stats/overview`,
        expect.any(Object)
      );
      expect(result).toEqual(statsData);
    });
  });

  describe("request timeout", () => {
    it("throws ApiError with status 408", async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise((_, reject) => {
            const err = new Error("AbortError");
            err.name = "AbortError";
            reject(err);
          })
      );

      const client = new ApiClient(baseUrl, 100);

      await expect(client.getHealth()).rejects.toThrow(ApiError);
      await expect(client.getHealth()).rejects.toMatchObject({
        status: 408,
        message: "Request timeout",
      });
    });
  });

  describe("HTTP error response", () => {
    it("throws ApiError with correct status", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () =>
          Promise.resolve({ message: "Internal Server Error", code: "ERR_500" }),
        headers: new Headers(),
      });

      const client = new ApiClient(baseUrl);

      await expect(client.getHealth()).rejects.toThrow(ApiError);
      await expect(client.getHealth()).rejects.toMatchObject({
        status: 500,
        message: "Internal Server Error",
      });
    });
  });

  describe("setBaseUrl / getBaseUrl", () => {
    it("work correctly", () => {
      const client = new ApiClient("http://initial");
      expect(client.getBaseUrl()).toBe("http://initial");

      client.setBaseUrl("http://updated");
      expect(client.getBaseUrl()).toBe("http://updated");
    });
  });
});
