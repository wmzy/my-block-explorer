import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Partial mock: the real storageLayouts table export stays intact so
// drizzle operators receive real columns; only the db client is faked.
const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/database/init', async importOriginal => {
  const actual = await importOriginal<typeof import('@/database/init')>();
  return {
    ...actual,
    db: mockDb,
  };
});

const mockGetClient = vi.hoisted(() => vi.fn());

vi.mock('@/services/RpcManager', () => ({
  rpcManager: {
    getClient: mockGetClient,
  },
}));

// The dynamic import inside the service would otherwise construct real
// explorer clients and hit the network.
vi.mock('storage-layout-fetcher', () => ({
  create: vi.fn(() => ({ explorers: [] })),
  fetchStorageLayout: vi.fn(async () => null),
}));

import { fetchStorageLayout } from 'storage-layout-fetcher';
import { storageLayoutService } from '@/services/StorageLayoutService';
import type { Address } from 'viem';
import type { StorageLayout } from '@/types/storage';

// The real module resolves null for "no layout found" (the service
// null-checks); its typed signature cannot express that, so the test
// double narrows through one cast.
const noLayout = null as unknown as StorageLayout;

const NOT_FOUND_TTL_HOURS = 24;
const MS_PER_HOUR = 1000 * 60 * 60;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * MS_PER_HOUR);

const chainId = 1;
const address = '0x1234567890123456789012345678901234567890' as Address;

const row = (overrides: Record<string, unknown> = {}) => ({
  chainId,
  address,
  layout: JSON.stringify({ storage: [], types: {} }),
  source: 'fetcher',
  isProxy: false,
  implementationAddress: null,
  createdAt: hoursAgo(48),
  updatedAt: hoursAgo(48),
  ...overrides,
});

describe('StorageLayoutService - NOT_FOUND cache TTL', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [] as Array<unknown>,
        }),
      }),
    }));
    mockDb.insert.mockImplementation(() => ({
      values: () => ({ onConflictDoUpdate: async () => undefined }),
    }));
    mockDb.delete.mockImplementation(() => ({ where: async () => undefined }));
  });

  it('serves a fresh NOT_FOUND row as a cached miss', async () => {
    mockDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [row({ layout: 'NOT_FOUND', source: null, updatedAt: hoursAgo(1) })],
        }),
      }),
    }));

    await expect(storageLayoutService.getFromDatabase(chainId, address)).rejects.toThrow(
      'CACHED_NOT_FOUND',
    );
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns a hit for a valid cached layout regardless of age', async () => {
    mockDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [row({ updatedAt: hoursAgo(30 * 24) })],
        }),
      }),
    }));

    const result = await storageLayoutService.getFromDatabase(chainId, address);

    expect(result).not.toBeNull();
    expect(result?.source).toBe('fetcher');
    expect(result?.layout).toEqual({ storage: [], types: {} });
  });

  it('deletes an expired NOT_FOUND row and reports a cache miss', async () => {
    mockDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            row({
              layout: 'NOT_FOUND',
              source: null,
              updatedAt: hoursAgo(NOT_FOUND_TTL_HOURS + 1),
            }),
          ],
        }),
      }),
    }));

    const result = await storageLayoutService.getFromDatabase(chainId, address);

    expect(result).toBeNull();
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
  });

  it('short-circuits getStorageLayout on a fresh NOT_FOUND entry', async () => {
    mockDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [row({ layout: 'NOT_FOUND', source: null, updatedAt: hoursAgo(1) })],
        }),
      }),
    }));

    const result = await storageLayoutService.getStorageLayout(chainId, address);

    expect(result.found).toBe(false);
    // No refetch and no re-cache happened for the fresh negative entry.
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('refetches after a NOT_FOUND entry has expired', async () => {
    // First getFromDatabase select: expired NOT_FOUND row. Any later
    // select (there are none on the miss path — the refetch goes through
    // rpc via evmole) falls back to [].
    const selectCalls: Array<Array<unknown>> = [
      [row({ layout: 'NOT_FOUND', source: null, updatedAt: hoursAgo(NOT_FOUND_TTL_HOURS + 1) })],
    ];
    mockDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => (selectCalls.length > 0 ? selectCalls.shift() : []),
        }),
      }),
    }));

    // No RPC client available: evmole bails, the miss is re-cached fresh.
    mockGetClient.mockResolvedValue(null);

    const result = await storageLayoutService.getStorageLayout(chainId, address);

    expect(result.found).toBe(false);
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
    // The negative entry was re-cached with a fresh timestamp.
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });
});

// Fetcher-race timer hygiene (statsRouteTimeout.test.ts pattern): the
// 8s FETCHER_TIMEOUT_MS race around the explorer fetch must clear its
// losing timer on BOTH outcomes — a fast fetch (or failure) leaves no
// live 8s timer per request, and a hung fetch falls through to the
// evmole path with nothing pending.
describe('StorageLayoutService - fetcher timeout timer hygiene', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(fetchStorageLayout).mockResolvedValue(noLayout);

    mockDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [] as Array<unknown>,
        }),
      }),
    }));
    mockDb.insert.mockImplementation(() => ({
      values: () => ({ onConflictDoUpdate: async () => undefined }),
    }));
    mockDb.delete.mockImplementation(() => ({ where: async () => undefined }));
    // evmole fallback bails fast (no RPC client) unless a test overrides.
    mockGetClient.mockResolvedValue(null);
  });

  afterEach(() => {
    // Nothing pending may leak past a test — the whole point of the fix.
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('clears the losing timer when the explorer fetch wins fast', async () => {
    vi.mocked(fetchStorageLayout).mockResolvedValue({ storage: [], types: {} });

    const pending = storageLayoutService.getStorageLayout(chainId, address);
    await vi.advanceTimersByTimeAsync(0);
    const result = await pending;

    expect(result.found).toBe(true);
    expect(result.source).toBe('fetcher');
    // Far past the window: the losing 8s timer was cleared, not left to
    // fire (getTimerCount below is the no-pending-timer proof).
    await vi.advanceTimersByTimeAsync(30_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a hung explorer fetch at 8s and leaves nothing pending', async () => {
    vi.mocked(fetchStorageLayout).mockImplementation(() => new Promise(() => {}));
    // evmole fallback bails fast (no bytecode) so the miss is re-cached.
    mockGetClient.mockResolvedValue({ getCode: async () => '0x' });

    const pending = storageLayoutService.getStorageLayout(chainId, address);
    await vi.advanceTimersByTimeAsync(8_000);
    const result = await pending;

    expect(result.found).toBe(false);
    expect(mockGetClient).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
