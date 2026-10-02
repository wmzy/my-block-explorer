// A failed stats read must not be answered as a 200 whose numbers look real.
//
// `GET /api/stats/overview` assembled each chain's row from
// blockService.getBlockStats / transactionService.getTransactionStats, and
// both services THROW on a DB failure. The route turned either throw into a
// zeroed default:
//
//   blockStats.catch(() => ({ totalBlocks: 0, latestBlock: null, ... }))
//   txStats.catch(() => ({ totalTransactions: 0, successRate: 0, ... }))
//
// so a corrupt/missing DuckDB produced a perfectly successful response
// claiming isIndexed:false, indexedBlocks:0, indexedTransactions:0,
// successRate:0 — the exact "index nothing / nothing indexed" answer, with
// no signal that the database could not be read at all. The cross-chain
// reduce then SUMMED those fabricated zeros into totalIndexedBlocks and
// totalIndexedTransactions. A caller polling this endpoint (the health
// dashboard, a monitoring script) has no way to tell "no data indexed" from
// "the database is broken" — the second is the failure that actually needs
// attention. The repo's own convention (events.ts indexing-status: 503
// rather than a zeroed status; AGENTS.md "a failed read must not be
// answered as a 200 with zeroed/empty content") says the same.
//
// The live RPC head probe keeps its honest shape: rpcConnected:false with
// null head, which the response has always documented as nullable.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { blockStats, txStats, rpcClient } = vi.hoisted(() => ({
  blockStats: vi.fn(),
  txStats: vi.fn(),
  rpcClient: vi.fn(),
}));

vi.mock('@/services/BlockService', () => ({
  blockService: { getBlockStats: blockStats },
}));

vi.mock('@/services/TransactionService', () => ({
  transactionService: { getTransactionStats: txStats },
}));

vi.mock('@/services/RpcManager', () => ({
  rpcManager: {
    getClient: rpcClient,
  },
}));

vi.mock('@/config/chains', async importOriginal => {
  const actual = await importOriginal<typeof import('@/config/chains')>();
  return {
    ...actual,
    // One chain keeps the assertions about the totals unambiguous.
    POPULAR_CHAINS: [{ id: 1, name: 'Ethereum' }],
  };
});

const importStatsRoute = async () => (await import('@/routes/stats')).default;

const statsFixture = (overrides: { totalBlocks?: number; latestBlock?: bigint | null } = {}) => ({
  totalBlocks: 12,
  latestBlock: 18_000_000n,
  avgBlockTime: 12,
  avgGasUsed: '1000',
  ...overrides,
});

const txStatsFixture = (overrides: { totalTransactions?: number; successRate?: number } = {}) => ({
  totalTransactions: 34,
  avgGasPrice: null,
  avgGasUsed: null,
  successRate: 0.9,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  blockStats.mockResolvedValue(statsFixture());
  txStats.mockResolvedValue(txStatsFixture());
  rpcClient.mockResolvedValue({ getBlockNumber: async () => 18_000_100n });
});

describe('GET /api/stats/overview failure honesty', () => {
  it('fails the whole read when the block statistics cannot be read', async () => {
    blockStats.mockRejectedValue(new Error('Failed to get block statistics'));
    const app = await importStatsRoute();

    const res = await app.request('/stats/overview');

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string; message?: string };
    // Same vocabulary as the sibling indexing-status failure.
    expect(body.error).toBe('stats_unavailable');
    expect(body.message).toContain('block statistics');
  });

  it('fails the whole read when the transaction statistics cannot be read', async () => {
    txStats.mockRejectedValue(new Error('Failed to get transaction statistics'));
    const app = await importStatsRoute();

    const res = await app.request('/stats/overview');

    expect(res.status).toBe(503);
  });

  it('keeps reporting zeros for a chain that simply has no indexed data', async () => {
    blockStats.mockResolvedValue(statsFixture({ totalBlocks: 0, latestBlock: null }));
    txStats.mockResolvedValue(txStatsFixture({ totalTransactions: 0 }));
    const app = await importStatsRoute();

    const res = await app.request('/stats/overview');

    // Zero is a real answer when the database answered; only a failed read
    // is an error.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totalIndexedBlocks: number };
    expect(body.totalIndexedBlocks).toBe(0);
  });
});
