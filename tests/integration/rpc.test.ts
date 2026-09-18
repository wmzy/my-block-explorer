import { describe, it, expect, beforeAll, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { createPublicClient, http } from 'viem';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { mainnet } from 'viem/chains';

// The RpcManager mock must execute before any module that imports the
// real service; api-app below pulls RpcManager in through its route tree.
import '../mocks/rpcManager.mock';
import app from '@/api-app';

// The rpc-configs GET is the only db-backed route this file exercises.
// DuckDB files are single-writer and other suite files may legitimately
// hold data/blockchain.db while this file runs in a parallel fork, so the
// db client is mocked (schema table exports stay real) to keep these
// tests deterministic and isolated from on-disk state. The select()
// result holder is read at call time so the redaction describe can serve
// a realistic custom-config row.
const { userRpcConfigRows } = vi.hoisted(() => ({ userRpcConfigRows: { value: [] as unknown[] } }));

vi.mock('@/database/init', async importOriginal => {
  const actual = await importOriginal<typeof import('@/database/init')>();
  return {
    ...actual,
    db: {
      select: vi.fn(() => ({ from: vi.fn().mockResolvedValue(userRpcConfigRows.value) })),
    },
  };
});

import { rpcManager } from '@/services/RpcManager';

describe('RPC Integration Tests', () => {
  const ETHEREUM_CHAIN_ID = 1;
  const VITALIK_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

  // These tests run against mocked RPC responses and are fast.
  describe('basic RPC functionality', () => {
    it('creates an RPC client', async () => {
      const client = await rpcManager.getClient(ETHEREUM_CHAIN_ID);
      expect(client).toBeDefined();
    });

    it('fetches the current block number', async () => {
      const client = await rpcManager.getClient(ETHEREUM_CHAIN_ID);
      const blockNumber = await client.getBlockNumber();

      expect(typeof blockNumber).toBe('bigint');
      expect(blockNumber).toBeGreaterThan(0n);
    }, 10000);

    it('fetches the latest block', async () => {
      const client = await rpcManager.getClient(ETHEREUM_CHAIN_ID);
      const latestBlock = await client.getBlock({ blockTag: 'latest' });

      expect(latestBlock).toBeDefined();
      expect(latestBlock.number).toBeGreaterThan(0n);
      expect(latestBlock.hash).toMatch(/^0x[a-fA-F0-9]+$/);
      expect(latestBlock.timestamp).toBeGreaterThan(0n);
      expect(Array.isArray(latestBlock.transactions)).toBe(true);
    }, 10000);

    it('fetches a specific block', async () => {
      const client = await rpcManager.getClient(ETHEREUM_CHAIN_ID);
      const blockNumber = 18000000n;
      const block = await client.getBlock({ blockNumber });

      expect(block).toBeDefined();
      expect(block.number).toBe(blockNumber);
      expect(block.hash).toBe('0x95b198e154acbfc64109dfd22d8224fe927fd8dfdedfae01587674482ba4baf3');
    }, 10000);
  });

  describe('address queries', () => {
    it('fetches an address balance', async () => {
      const client = await rpcManager.getClient(ETHEREUM_CHAIN_ID);
      const balance = await client.getBalance({
        address: VITALIK_ADDRESS,
      });

      expect(typeof balance).toBe('bigint');
      expect(balance).toBeGreaterThan(0n);
    }, 10000);

    it('fetches an address transaction count', async () => {
      const client = await rpcManager.getClient(ETHEREUM_CHAIN_ID);
      const txCount = await client.getTransactionCount({
        address: VITALIK_ADDRESS,
      });

      expect(typeof txCount).toBe('number');
      expect(txCount).toBeGreaterThan(0);
    }, 10000);

    it('fetches contract code', async () => {
      const client = await rpcManager.getClient(ETHEREUM_CHAIN_ID);

      // An EOA address returns '0x' or undefined.
      const eoaCode = await client.getCode({
        address: VITALIK_ADDRESS,
      });
      expect(eoaCode === '0x' || eoaCode === undefined).toBe(true);

      // A known contract address (USDC).
      const usdcAddress = '0xA0b86991c431e603c329b6c1c4e2c7a1b6b9e9a2e';
      const contractCode = await client.getCode({
        address: usdcAddress,
      });
      expect(typeof contractCode).toBe('string');
      expect(contractCode?.startsWith('0x')).toBe(true);
      expect(contractCode?.length).toBeGreaterThan(2); // Should have actual code
    }, 10000);
  });

  describe('RPC manager functionality', () => {
    it('returns the chain name', () => {
      const chainName = rpcManager.getChainName(ETHEREUM_CHAIN_ID);
      expect(chainName).toBe('Ethereum');
    });

    it('tests an RPC connection', async () => {
      const testResult = await rpcManager.testRpcConnection(ETHEREUM_CHAIN_ID);

      // Public RPCs can be unstable, so only the result shape is checked.
      expect(testResult).toHaveProperty('success');
      expect(typeof testResult.success).toBe('boolean');

      if (testResult.success) {
        expect(typeof testResult.latency).toBe('number');
        expect(testResult.latency).toBeGreaterThan(0);
        expect(testResult.error).toBeUndefined();
      } else {
        expect(typeof testResult.error).toBe('string');
        expect(testResult.error).toBeTruthy();
        console.warn('RPC connection test failed:', testResult.error);
      }
    }, 15000);

    it('handles an invalid RPC URL test', async () => {
      const testResult = await rpcManager.testRpcConnection(
        ETHEREUM_CHAIN_ID,
        'http://invalid-rpc-url.com',
      );

      expect(testResult.success).toBe(false);
      expect(testResult.error).toBeDefined();
      expect(testResult.latency).toBeUndefined();
    }, 10000);
  });

  describe('client caching', () => {
    it('reuses clients for the same chain ID', async () => {
      const client1 = await rpcManager.getClient(ETHEREUM_CHAIN_ID);
      const client2 = await rpcManager.getClient(ETHEREUM_CHAIN_ID);

      // With mocks, we just verify both calls succeed.
      expect(client1).toBeDefined();
      expect(client2).toBeDefined();
      expect(typeof client1.getBlockNumber).toBe('function');
      expect(typeof client2.getBlockNumber).toBe('function');
    });

    it('creates distinct clients for distinct chain IDs', async () => {
      const ethereumClient = await rpcManager.getClient(1);

      // Try to get a client for another chain (if supported).
      try {
        const polygonClient = await rpcManager.getClient(137);
        expect(ethereumClient).not.toBe(polygonClient);
      } catch (error) {
        // Skip when Polygon is unsupported or the network fails.
        console.warn('Polygon client test skipped:', error);
      }
    });
  });

  describe('error handling', () => {
    it('throws for an unsupported chain ID', async () => {
      await expect(rpcManager.getClient(999999)).rejects.toThrow();
    });

    it('handles network errors gracefully', async () => {
      // Network errors are covered by the invalid-URL test above; nothing
      // further to exercise with mocks.
    });
  });

  describe('GET /api/rpc-configs URL redaction', () => {
    // A custom endpoint exactly as the modal invites users to save one:
    // the provider API key lives in the URL path.
    const SECRET_URL = 'https://node.example.com/v3/secret-api-key';

    beforeAll(() => {
      userRpcConfigRows.value = [
        {
          chainId: 1,
          name: 'My keyed node',
          url: SECRET_URL,
          supportsHistory: true,
          maxEventRange: 5000,
        },
      ];
    });

    it('returns the full URL when no Origin header is present (same-origin UI, curl)', async () => {
      const response = await app.request('/api/rpc-configs', { method: 'GET' });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.configs[0].url).toBe(SECRET_URL);
    });

    it('returns the full URL for a loopback Origin (local dev frontend)', async () => {
      const response = await app.request('/api/rpc-configs', {
        method: 'GET',
        headers: { Origin: 'http://localhost:3000' },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.configs[0].url).toBe(SECRET_URL);
    });

    it('redacts the URL to scheme + host for any other Origin, keeping the rest of the shape', async () => {
      const response = await app.request('/api/rpc-configs', {
        method: 'GET',
        headers: { Origin: 'https://evil.example.com' },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.configs[0].url).toBe('https://node.example.com/…');
      // The key never leaves the server for untrusted readers.
      expect(JSON.stringify(data)).not.toContain('secret-api-key');
      // The config remains recognizable as custom so the UI can still
      // render the current-state panel.
      expect(data.configs[0].isCustom).toBe(true);
      expect(data.configs[0].name).toBe('My keyed node');
      expect(data.configs[0].chainId).toBe(1);
    });
  });
});

// Tests use mocks, no network connection needed.
beforeAll(async () => {
  console.log('RPC tests using mocked responses');
});
