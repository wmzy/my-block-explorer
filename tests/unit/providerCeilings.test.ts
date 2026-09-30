/**
 * providerCeilings (services/providerCeilings.ts): persisted per-chain
 * eth_getLogs span ceilings with an in-memory fast path. Pins the load /
 * record / persist contract and the DB-failure degrade:
 * - load is lazy and cached ONCE per process (failure included — a DB
 *   hiccup at boot must not turn every getter into a retry loop),
 * - record updates memory immediately (the walk's next sub-span uses the
 *   smaller ceiling without waiting for a write round-trip) and persists
 *   fire-and-forget,
 * - no DB failure ever rejects into the caller — indexing must not break
 *   because a limits table is unavailable.
 *
 * The db seam is the module's only DB dependency, faked here with the
 * same chainable-builder shape the real drizzle db exposes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({
  // Rows a select of provider_limits resolves with.
  rows: [] as Array<{ chainId: number; maxLogSpan: bigint; updatedAt: Date }>,
  selectCount: 0,
  selectError: null as Error | null,
  // Upserts recorded by the insert builder (values + onConflict set).
  persists: [] as Array<{ values: Record<string, unknown>; set: Record<string, unknown> }>,
  insertError: null as Error | null,
}));

const logMocks = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/server/logger', () => ({
  createLogger: () => logMocks,
}));

vi.mock('@/database/drizzle', () => {
  // No table-identity checks: the service touches only provider_limits,
  // and importing the schema module inside the factory would freeze the
  // FIRST module-registry instance while vi.resetModules hands the
  // service a fresh one (identity mismatch, flaky by test order).
  const selectBuilder = () => ({
    from: () => ({
      then: (res: unknown, rej: unknown) => {
        fake.selectCount += 1;
        const settled = fake.selectError
          ? Promise.reject(fake.selectError)
          : Promise.resolve([...fake.rows]);
        return settled.then(res as never, rej as never);
      },
    }),
  });

  const insertBuilder = () => {
    let lastValues: Record<string, unknown> | undefined;
    const b: Record<string, unknown> = {
      values: (v: Record<string, unknown>) => {
        lastValues = v;
        return b;
      },
      onConflictDoUpdate: (args: { target: unknown; set: Record<string, unknown> }) => {
        fake.persists.push({ values: lastValues!, set: args.set });
        return b;
      },
      then: (res: unknown, rej: unknown) => {
        const settled = fake.insertError
          ? Promise.reject(fake.insertError)
          : Promise.resolve([]);
        return settled.then(res as never, rej as never);
      },
    };
    return b;
  };

  return {
    db: {
      select: () => selectBuilder(),
      insert: () => insertBuilder(),
    },
  };
});

// Module-level state (the memory map + cached load promise) must be fresh
// per test: reset the registry and import the service dynamically.
const freshService = async () => {
  vi.resetModules();
  return import('@/services/providerCeilings');
};

beforeEach(() => {
  fake.rows = [];
  fake.selectCount = 0;
  fake.selectError = null;
  fake.persists = [];
  fake.insertError = null;
  logMocks.warn.mockClear();
});

describe('getProviderLogSpanCeiling', () => {
  it('seeds from provider_limits on first access, then caches the load', async () => {
    fake.rows = [
      { chainId: 1, maxLogSpan: 500n, updatedAt: new Date() },
      { chainId: 10, maxLogSpan: 1000n, updatedAt: new Date() },
    ];
    const { getProviderLogSpanCeiling } = await freshService();

    expect(await getProviderLogSpanCeiling(1)).toBe(500n);
    expect(await getProviderLogSpanCeiling(10)).toBe(1000n);
    expect(await getProviderLogSpanCeiling(99)).toBeUndefined();
    // One lazy load served every getter — no per-get SELECT.
    expect(fake.selectCount).toBe(1);
    await getProviderLogSpanCeiling(1);
    expect(fake.selectCount).toBe(1);
  });

  it('degrades to in-memory-only when the load fails, warning once', async () => {
    fake.selectError = new Error('DuckDB file locked');
    const { getProviderLogSpanCeiling, recordProviderLogSpanCeiling } = await freshService();

    await expect(getProviderLogSpanCeiling(1)).resolves.toBeUndefined();
    expect(logMocks.warn).toHaveBeenCalledTimes(1);

    // Memory still works after the failed load, and the cached failure is
    // not retried on later getters.
    recordProviderLogSpanCeiling(1, 250n);
    await expect(getProviderLogSpanCeiling(1)).resolves.toBe(250n);
    expect(fake.selectCount).toBe(1);
  });
});

describe('recordProviderLogSpanCeiling', () => {
  it('updates memory immediately and persists fire-and-forget via upsert', async () => {
    const { getProviderLogSpanCeiling, recordProviderLogSpanCeiling } = await freshService();

    recordProviderLogSpanCeiling(1, 250n);

    // Memory is synchronous: even before any await, the getter (which
    // short-circuits on the memory hit) sees the new ceiling.
    await expect(getProviderLogSpanCeiling(1)).resolves.toBe(250n);
    // The record did not trigger a load — memory answered first.
    expect(fake.selectCount).toBe(0);

    await vi.waitFor(() => expect(fake.persists).toHaveLength(1));
    expect(fake.persists[0]?.values).toMatchObject({ chainId: 1, maxLogSpan: 250n });
    expect(fake.persists[0]?.set).toMatchObject({ maxLogSpan: 250n });
  });

  it('a persist failure warns and never rejects into the caller', async () => {
    fake.insertError = new Error('disk full');
    const { recordProviderLogSpanCeiling, getProviderLogSpanCeiling } = await freshService();

    recordProviderLogSpanCeiling(1, 125n);

    await vi.waitFor(() => expect(logMocks.warn).toHaveBeenCalledTimes(1));
    // The ceiling stays usable in memory — persistence is an optimization.
    await expect(getProviderLogSpanCeiling(1)).resolves.toBe(125n);
  });
});
