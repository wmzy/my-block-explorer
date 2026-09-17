import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { storageLayoutService } from '@/services/StorageLayoutService';
import type { Address } from 'viem';

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
