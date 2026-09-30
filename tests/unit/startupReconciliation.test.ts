// Startup reconciliation contract: importing api-app must NOT fire the
// zombie-walk UPDATEs (the vite dev bridge imports this module per dev
// boot, and a module-scope call would race the first request — the blanket
// UPDATE could flip a job this same process just started). Instead the
// standalone server awaits the exported reconcileStartupState() before
// listen (src/server.ts), so these tests pin: no import-time trigger,
// both reconcilers run per call, the call awaits them, and reconciler
// failures are swallowed (logged inside) rather than blocking boot.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  reconcileRanges: vi.fn().mockResolvedValue(undefined),
  reconcileScans: vi.fn().mockResolvedValue(undefined),
}));

// Same db-mock shape as api-routes.test.ts: DuckDB is single-writer, so
// the unit suite must not open data/blockchain.db while parallel forks
// may hold it (schema table exports stay real for the route imports).
vi.mock('@/database/init', async importOriginal => {
  const actual = await importOriginal<typeof import('@/database/init')>();
  return {
    ...actual,
    db: {
      select: vi.fn(() => ({ from: vi.fn().mockResolvedValue([]) })),
    },
  };
});

vi.mock('@/services/EventIndexingService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/EventIndexingService')>();
  return { ...actual, reconcileInterruptedRanges: mocks.reconcileRanges };
});

vi.mock('@/services/AddressScanService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/AddressScanService')>();
  return { ...actual, reconcileInterruptedAddressScans: mocks.reconcileScans };
});

const { reconcileStartupState } = await import('@/api-app');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reconcileStartupState', () => {
  it('is not triggered by importing api-app (dev-bridge boots stay DB-free)', () => {
    expect(mocks.reconcileRanges).not.toHaveBeenCalled();
    expect(mocks.reconcileScans).not.toHaveBeenCalled();
  });

  it('runs both reconcilers on each call', async () => {
    await reconcileStartupState();

    expect(mocks.reconcileRanges).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileScans).toHaveBeenCalledTimes(1);
  });

  it('starts both reconcilers in parallel and awaits them', async () => {
    let resolveRanges!: () => void;
    mocks.reconcileRanges.mockReturnValueOnce(
      new Promise<void>(resolve => {
        resolveRanges = resolve;
      }),
    );

    let settled = false;
    const done = reconcileStartupState().then(() => {
      settled = true;
    });

    // Promise.all invokes both reconcilers synchronously — no sequential
    // awaiting between the range and scan UPDATEs.
    expect(mocks.reconcileRanges).toHaveBeenCalled();
    expect(mocks.reconcileScans).toHaveBeenCalled();

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false); // still waiting on the range UPDATE

    resolveRanges();
    await done;
    expect(settled).toBe(true);
  });

  it('swallows a reconciler failure so boot is never blocked', async () => {
    mocks.reconcileRanges.mockRejectedValueOnce(new Error('db locked'));

    await expect(reconcileStartupState()).resolves.toBeUndefined();
    expect(mocks.reconcileScans).toHaveBeenCalledTimes(1);
  });
});
