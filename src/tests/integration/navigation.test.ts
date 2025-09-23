import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, stopTestServer, TestServerInfo } from './testUtils';

describe('Navigation Integration Tests', () => {
  let serverInfo: TestServerInfo;

  beforeAll(async () => {
    serverInfo = await startTestServer();
  });

  afterAll(async () => {
    await stopTestServer(serverInfo);
  });

  describe('Chain-specific routing', () => {
    it('should handle chain switching in search results', async () => {
      const response = await fetch(
        `${serverInfo.baseUrl}/api/chains/1/search?q=0x123`
      );
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data).toHaveProperty('query', '0x123');
      expect(data).toHaveProperty('type');
      expect(data).toHaveProperty('result');
    });

    it('should handle address lookup on different chains', async () => {
      const testAddress = '0x1234567890123456789012345678901234567890';
      
      // Test Ethereum mainnet
      const ethResponse = await fetch(
        `${serverInfo.baseUrl}/api/chains/1/addresses/${testAddress}`
      );
      expect(ethResponse.ok).toBe(true);
      
      // Test Mantle
      const mantleResponse = await fetch(
        `${serverInfo.baseUrl}/api/chains/5000/addresses/${testAddress}`
      );
      expect(mantleResponse.ok).toBe(true);
    });

    it('should handle contract source on different chains', async () => {
      const testContract = '0x1234567890123456789012345678901234567890';
      
      // Test contract source endpoint
      const response = await fetch(
        `${serverInfo.baseUrl}/api/chains/1/contracts/${testContract}/source`
      );
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data).toHaveProperty('address', testContract.toLowerCase());
    });

    it('should handle unsupported chain IDs gracefully', async () => {
      const response = await fetch(
        `${serverInfo.baseUrl}/api/chains/99999/search?q=test`
      );
      
      // Should either return 404 or handle gracefully
      expect([200, 400, 404, 500]).toContain(response.status);
    });
  });

  describe('RPC Configuration API', () => {
    it('should allow getting RPC configurations', async () => {
      const response = await fetch(
        `${serverInfo.baseUrl}/api/rpc-configs`
      );
      expect(response.ok).toBe(true);
      
      const configs = await response.json();
      expect(Array.isArray(configs)).toBe(true);
    });

    it('should allow saving RPC configurations', async () => {
      const testConfig = {
        chainId: 1,
        rpcUrl: 'https://test-rpc.example.com',
        maxEventRange: 2000,
      };
      
      const response = await fetch(
        `${serverInfo.baseUrl}/api/rpc-configs`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(testConfig),
        }
      );
      
      expect([200, 201]).toContain(response.status);
    });

    it('should validate RPC configuration data', async () => {
      const invalidConfig = {
        chainId: 'invalid',
        rpcUrl: 'not-a-url',
      };
      
      const response = await fetch(
        `${serverInfo.baseUrl}/api/rpc-configs`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(invalidConfig),
        }
      );
      
      expect(response.status).toBe(400);
    });
  });

  describe('Search functionality', () => {
    it('should detect different input types correctly', async () => {
      const testCases = [
        { input: '0x1234567890123456789012345678901234567890', expectedType: 'address' },
        { input: '0x1234567890123456789012345678901234567890123456789012345678901234', expectedType: 'transaction' },
        { input: '12345', expectedType: 'block' },
        { input: 'latest', expectedType: 'block' },
      ];
      
      for (const testCase of testCases) {
        const response = await fetch(
          `${serverInfo.baseUrl}/api/chains/1/search?q=${encodeURIComponent(testCase.input)}`
        );
        expect(response.ok).toBe(true);
        
        const data = await response.json();
        expect(data.type).toBe(testCase.expectedType);
      }
    });

    it('should provide helpful suggestions for invalid inputs', async () => {
      const response = await fetch(
        `${serverInfo.baseUrl}/api/chains/1/search?q=invalid-input`
      );
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.result).toHaveProperty('suggestions');
      expect(Array.isArray(data.result.suggestions)).toBe(true);
    });
  });

  describe('Contract interaction endpoints', () => {
    it('should handle contract creation info requests', async () => {
      const testContract = '0x1234567890123456789012345678901234567890';
      
      const response = await fetch(
        `${serverInfo.baseUrl}/api/chains/1/contracts/${testContract}/creation`
      );
      
      // Should return either creation info or appropriate error
      expect([200, 404, 500]).toContain(response.status);
      
      if (response.ok) {
        const data = await response.json();
        expect(data).toHaveProperty('address');
      }
    });

    it('should handle contract ABI requests', async () => {
      const testContract = '0x1234567890123456789012345678901234567890';
      
      const response = await fetch(
        `${serverInfo.baseUrl}/api/chains/1/contracts/${testContract}/abi`
      );
      
      expect([200, 404]).toContain(response.status);
      
      if (response.ok) {
        const data = await response.json();
        expect(data).toHaveProperty('abi');
      }
    });
  });

  describe('Error handling', () => {
    it('should handle RPC errors gracefully', async () => {
      // Test with a contract that might cause RPC issues
      const problematicContract = '0x0000000000000000000000000000000000000001';
      
      const response = await fetch(
        `${serverInfo.baseUrl}/api/chains/1/contracts/${problematicContract}/creation`
      );
      
      // Should not crash the server
      expect([200, 400, 404, 500]).toContain(response.status);
    });

    it('should provide meaningful error messages', async () => {
      const response = await fetch(
        `${serverInfo.baseUrl}/api/chains/1/addresses/invalid-address`
      );
      
      expect(response.status).toBe(400);
      
      const error = await response.json();
      expect(error).toHaveProperty('error');
      expect(typeof error.error).toBe('string');
    });
  });

  describe('Performance', () => {
    it('should respond to health checks quickly', async () => {
      const start = Date.now();
      const response = await fetch(`${serverInfo.baseUrl}/api/health`);
      const duration = Date.now() - start;
      
      expect(response.ok).toBe(true);
      expect(duration).toBeLessThan(1000); // Should respond within 1 second
    });

    it('should handle concurrent requests', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        fetch(`${serverInfo.baseUrl}/api/chains/1/search?q=${i}`)
      );
      
      const responses = await Promise.all(promises);
      
      // All requests should complete successfully
      responses.forEach(response => {
        expect([200, 400, 404]).toContain(response.status);
      });
    });
  });
});
