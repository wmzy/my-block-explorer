// stats route timer hygiene: withTimeout races each chain's RPC
// getBlockNumber against a 3s setTimeout. The losing timer must be
// cleared — a winning promise that leaves its timeout pending keeps the
// event loop alive for the full window (and stacks one timer per chain
// per request: 10 popular chains = 10 stray timers per /stats/overview).
// Pinned with fake timers via vi.getTimerCount().
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBlockStats: vi.fn(),
  getTransactionStats: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('@/services/BlockService', () => ({ blockService: { getBlockStats: mocks.getBlockStats } }));
vi.mock('@/services/TransactionService', () => ({
  transactionService: { getTransactionStats: mocks.getTransactionStats },
}));
vi.mock('@/services/RpcManager', () => ({ rpcManager: { getClient: mocks.getClient } }));

import app from '@/routes/stats';

vi.useFakeTimers();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getBlockStats.mockResolvedValue({
    totalBlocks: 5,
    latestBlock: null,
    avgBlockTime: null,
    avgGasUsed: null,
  });
  mocks.getTransactionStats.mockResolvedValue({
    totalTransactions: 10,
    avgGasPrice: null,
    avgGasUsed: null,
    successRate: 1,
  });
});

afterEach(() => {
  // Nothing pending may leak past a test — asserted below per outcome.
  expect(vi.getTimerCount()).toBe(0);
});

describe('withTimeout timer hygiene (GET /stats/overview)', () => {
  it('clears the losing timer when the RPC promise wins the race', async () => {
    mocks.getClient.mockResolvedValue({ getBlockNumber: vi.fn().mockResolvedValue(42n) });

    const pending = app.request('/stats/overview');
    // Let the mocked services resolve; every withTimeout winner must have
    // cleared its own 3s timer by the time the response lands.
    await vi.advanceTimersByTimeAsync(0);
    const response = await pending;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.connectedChains).toBe(body.displayedChains);
    // The whole point: no 3s timer outlives its race.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still degrades to null after the window (and leaves nothing pending)', async () => {
    mocks.getClient.mockResolvedValue({
      getBlockNumber: vi.fn(() => new Promise<bigint>(() => {})), // hangs forever
    });

    const pending = app.request('/stats/overview');
    await vi.advanceTimersByTimeAsync(3_000);
    const response = await pending;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.connectedChains).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
