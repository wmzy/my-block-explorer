// Gas history service: pure extraction/degradation helpers plus the
// fetch/hook layer. The only network edge is the shared viem client
// factory, mocked throughout — no test here touches a real RPC.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import {
  GAS_HISTORY_BLOCK_COUNT,
  buildGasHistory,
  buildSparklinePath,
  classifyGasFailure,
  extractTiers,
  fetchGasHistory,
  formatGwei,
  gasWindowLabel,
  hexWeiToGwei,
  useGasHistory,
  weiToGwei,
} from '@/services/gasHistory';
import { clearAllCaches } from '@/util/useQuery';
import { createRpcClient } from '@/utils/realTimeData';

vi.mock('@/utils/realTimeData', () => ({ createRpcClient: vi.fn() }));

const GWEI = 1_000_000_000n;

// --- gwei conversion ---

describe('weiToGwei / hexWeiToGwei', () => {
  it('converts wei bigints to exact gwei numbers', () => {
    expect(weiToGwei(15_000_000_000n)).toBe(15);
    expect(weiToGwei(1n)).toBe(1e-9);
    expect(weiToGwei(0n)).toBe(0);
    // 1,234,567,890,123,456 wei < 2^53, so the double is exact.
    expect(weiToGwei(1_234_567_890_123_456n)).toBe(1_234_567.890123456);
  });

  it('converts hex quantities through BigInt (never a parseFloat path)', () => {
    expect(hexWeiToGwei('0x3b9aca00')).toBe(1); // 1e9
    expect(hexWeiToGwei('0x37e11d600')).toBe(15); // 15e9
    expect(hexWeiToGwei('0x1')).toBe(1e-9);
    // Alpha-heavy hex: parseFloat('0xdeadbeef') would yield 0.
    expect(hexWeiToGwei('0xdeadbeef')).toBe(3.735928559);
    // 1e18 wei — beyond 2^53 for the raw integer, but exactly a double.
    expect(hexWeiToGwei('0xde0b6b3a7640000')).toBe(1e9);
  });
});

describe('formatGwei', () => {
  it('uses two decimals above 1 gwei and cuts trailing zeros', () => {
    expect(formatGwei(20)).toBe('20');
    expect(formatGwei(7.312)).toBe('7.31');
    expect(formatGwei(0)).toBe('0');
  });

  it('keeps four decimals for sub-gwei tips and one above 100', () => {
    expect(formatGwei(0.0004)).toBe('0.0004');
    expect(formatGwei(0.5)).toBe('0.5');
    expect(formatGwei(123.456)).toBe('123.5');
  });

  it('never fabricates a number for non-finite input', () => {
    expect(formatGwei(Number.NaN)).toBe('—');
    expect(formatGwei(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

// --- window labeling ---

describe('gasWindowLabel', () => {
  it('labels the window from the actual block numbers, not a wall-clock guess', () => {
    expect(gasWindowLabel(100, 219)).toBe('last 120 blocks · #100–#219');
    expect(gasWindowLabel(5, 5)).toBe('last 1 block · #5–#5');
  });

  it('groups block numbers with separators', () => {
    expect(gasWindowLabel(1_000_000, 1_000_119)).toBe(
      'last 120 blocks · #1,000,000–#1,000,119',
    );
  });

  it('refuses an inverted range instead of a negative count', () => {
    expect(gasWindowLabel(10, 9)).toBe('no blocks');
  });
});

// --- tiers ---

describe('extractTiers', () => {
  it('averages the 25/50/75th percentile rewards over the newest 10 blocks only', () => {
    // Two ancient blocks with huge rewards that must not influence the
    // average, then ten identical ones.
    const rewards = [
      [50n * GWEI, 60n * GWEI, 70n * GWEI],
      [50n * GWEI, 60n * GWEI, 70n * GWEI],
      ...Array.from({ length: 10 }, () => [1n * GWEI, 2n * GWEI, 3n * GWEI]),
    ];
    expect(extractTiers(rewards)).toEqual({ slow: 1, standard: 2, fast: 3 });
  });

  it('is null when rewards are absent or contain no complete triple', () => {
    expect(extractTiers(undefined)).toBeNull();
    expect(extractTiers([])).toBeNull();
    expect(extractTiers([[], [], []])).toBeNull();
    // Shorter than the requested percentile count: skipped, not padded.
    expect(extractTiers([[1n, 2n]])).toBeNull();
  });

  it('averages only the entries that carry a full triple', () => {
    const rewards = [
      [1n * GWEI, 2n * GWEI], // incomplete → skipped
      [], // empty block → skipped
      [3n * GWEI, 4n * GWEI, 6n * GWEI],
    ];
    expect(extractTiers(rewards)).toEqual({ slow: 3, standard: 4, fast: 6 });
  });
});

// --- snapshot assembly ---

describe('buildGasHistory', () => {
  it('drops the speculative next-block base fee from the window', () => {
    // 121 entries (120 blocks + the derived prediction); the prediction is
    // far larger so a leak into "current" would be obvious.
    const baseFeePerGas = Array.from({ length: 121 }, (_, i) => BigInt(i + 1) * GWEI);
    const result = buildGasHistory(1, { oldestBlock: 100n, baseFeePerGas, reward: [] });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const { snapshot } = result;
    expect(snapshot.baseFeeGwei).toHaveLength(120);
    expect(snapshot.baseFeeGwei[0]).toBe(1);
    // Current is the newest REAL block (120 gwei), not the 121 prediction.
    expect(snapshot.currentBaseFeeGwei).toBe(120);
    expect(snapshot.oldestBlock).toBe(100);
    expect(snapshot.newestBlock).toBe(219);
    expect(snapshot.averageBaseFeeGwei).toBeCloseTo(60.5, 10);
    // No rewards returned → tiers explicitly absent, not zero.
    expect(snapshot.tiers).toBeNull();
  });

  it('keeps a short response window as-is (nodes with shallow history)', () => {
    const result = buildGasHistory(137, {
      oldestBlock: 10n,
      baseFeePerGas: [2n * GWEI, 4n * GWEI, 8n * GWEI, 16n * GWEI, 32n * GWEI],
      reward: [[1n, 2n, 3n]],
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.snapshot.baseFeeGwei).toHaveLength(5);
    expect(result.snapshot.newestBlock).toBe(14);
    expect(result.snapshot.currentBaseFeeGwei).toBe(32);
    expect(result.snapshot.tiers).toEqual({ slow: 1e-9, standard: 2e-9, fast: 3e-9 });
  });

  it('treats an all-zero base-fee window as pre-EIP-1559, unavailable', () => {
    const result = buildGasHistory(1, {
      oldestBlock: 0n,
      baseFeePerGas: [0n, 0n, 0n],
      reward: [[0n, 0n, 0n]],
    });
    expect(result).toEqual({
      status: 'unavailable',
      chainId: 1,
      reason: 'no-base-fee-data',
    });
  });

  it('treats an empty series as unavailable', () => {
    expect(buildGasHistory(1, { oldestBlock: 0n, baseFeePerGas: [] })).toEqual({
      status: 'unavailable',
      chainId: 1,
      reason: 'no-base-fee-data',
    });
  });
});

// --- sparkline ---

// Parses "M0.00,4.00 L120.00,24.00 …" into [x, y] number pairs.
const pathPoints = (path: string): [number, number][] =>
  path
    .split(' ')
    .map(segment => {
      const [x, y] = segment.slice(1).split(',');
      return [Number(x), Number(y)] as [number, number];
    });

describe('buildSparklinePath', () => {
  it('returns an empty path for an empty series', () => {
    expect(buildSparklinePath([])).toBe('');
  });

  it('maps min to the bottom band and max to the top band over the full width', () => {
    expect(buildSparklinePath([3, 1, 2])).toBe('M0.00,4.00 L120.00,44.00 L240.00,24.00');
  });

  it('keeps x strictly increasing and spanning 0..width for long series', () => {
    const series = Array.from({ length: 120 }, (_, i) => Math.sin(i / 7) * 50 + 50 + i * 0.1);
    const points = pathPoints(buildSparklinePath(series));
    expect(points).toHaveLength(120);
    expect(points[0]?.[0]).toBe(0);
    expect(points[points.length - 1]?.[0]).toBe(240);
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i]?.[0]).toBeGreaterThan(points[i - 1]?.[0] ?? -Infinity);
    }
    // Default 4px padding keeps every y inside the 240x48 viewBox.
    for (const [, y] of points) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(48);
    }
  });

  it('draws a flat mid-line for a constant series', () => {
    const points = pathPoints(buildSparklinePath([5, 5, 5, 5]));
    expect(points.map(([, y]) => y)).toEqual([24, 24, 24, 24]);
  });

  it('draws a full-width constant line for a single-point series', () => {
    expect(buildSparklinePath([7])).toBe('M0.00,24.00 L240.00,24.00');
  });

  it('clamps y into the viewBox even for a degenerate pad configuration', () => {
    // pad 60 > height 48 would push points outside [0, 48] unclamped.
    const points = pathPoints(buildSparklinePath([1, 2], 240, 48, 60));
    expect(points).toHaveLength(2);
    for (const [, y] of points) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(48);
    }
  });
});

// --- failure classification ---

describe('classifyGasFailure', () => {
  it('recognizes unsupported methods, including through wrapped causes', () => {
    expect(classifyGasFailure(new Error('Method not found'))).toBe('method-not-supported');
    expect(
      classifyGasFailure(
        new Error('HTTP request failed', {
          cause: new Error('the method eth_feeHistory does not exist/is not available'),
        }),
      ),
    ).toBe('method-not-supported');
    expect(classifyGasFailure(new Error('eth_feeHistory is not supported by this node'))).toBe(
      'method-not-supported',
    );
  });

  it('classifies everything else as a plain fetch failure', () => {
    expect(classifyGasFailure(new Error('network timeout'))).toBe('fetch-failed');
    expect(classifyGasFailure('boom')).toBe('fetch-failed');
  });
});

// --- fetch layer (mocked viem client) ---

describe('fetchGasHistory', () => {
  const getFeeHistory = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createRpcClient).mockResolvedValue({ getFeeHistory } as never);
  });

  it('asks for a 120-block window with 25/50/75 reward percentiles', async () => {
    getFeeHistory.mockResolvedValue({
      oldestBlock: 100n,
      baseFeePerGas: [1n * GWEI, 2n * GWEI, 1n * GWEI],
      reward: [[1n, 2n, 3n]],
    });

    const result = await fetchGasHistory(1);

    expect(getFeeHistory).toHaveBeenCalledWith({
      blockCount: GAS_HISTORY_BLOCK_COUNT,
      rewardPercentiles: [25, 50, 75],
    });
    expect(result.status).toBe('ok');
  });

  it('settles an explicit unavailable state instead of throwing on RPC failure', async () => {
    getFeeHistory.mockRejectedValue(new Error('Method not found'));

    await expect(fetchGasHistory(1)).resolves.toEqual({
      status: 'unavailable',
      chainId: 1,
      reason: 'method-not-supported',
    });
  });

  it('classifies a client-creation failure too', async () => {
    vi.mocked(createRpcClient).mockRejectedValue(new Error('all transports down'));

    await expect(fetchGasHistory(1)).resolves.toEqual({
      status: 'unavailable',
      chainId: 1,
      reason: 'fetch-failed',
    });
  });

  it('never touches an endpoint for a non-positive chain id', async () => {
    await expect(fetchGasHistory(0)).resolves.toEqual({
      status: 'unavailable',
      chainId: 0,
      reason: 'unsupported-chain',
    });
    expect(createRpcClient).not.toHaveBeenCalled();
  });
});

// --- polled hook ---

describe('useGasHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    clearAllCaches();
  });

  afterEach(() => {
    clearAllCaches();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const feeHistoryFor = (oldestBlock: bigint, baseGwei: bigint) => ({
    oldestBlock,
    baseFeePerGas: [baseGwei, baseGwei, baseGwei],
    reward: [[1n * GWEI, 2n * GWEI, 3n * GWEI]],
  });

  it('resets to the first-load state on a chain switch and settles the new chain', async () => {
    const eth = feeHistoryFor(100n, 10n * GWEI);
    const polygon = feeHistoryFor(500n, 100n * GWEI);
    vi.mocked(createRpcClient).mockImplementation(async (chainId: number) => ({
      getFeeHistory: vi.fn().mockResolvedValue(chainId === 1 ? eth : polygon),
    }) as never);

    const { result, rerender } = renderHook(({ chainId }) => useGasHistory(chainId), {
      initialProps: { chainId: 1 },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data?.status).toBe('ok');
    if (result.current.data?.status === 'ok') {
      expect(result.current.data.snapshot.currentBaseFeeGwei).toBe(10);
    }

    rerender({ chainId: 137 });

    // Fresh args: the per-args slot has no data, so the hook reports the
    // first-load state. (The result store keeps chain 1's last settle until
    // the new one lands — the view's cross-chain guard exists for exactly
    // this, which is why both result variants carry their chainId.)
    expect(result.current.loading).toBe(true);
    expect(result.current.data?.chainId).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data?.status).toBe('ok');
    expect(result.current.data?.chainId).toBe(137);
    if (result.current.data?.status === 'ok') {
      expect(result.current.data.snapshot.chainId).toBe(137);
      expect(result.current.data.snapshot.currentBaseFeeGwei).toBe(100);
    }
  });

  it('re-fetches on the 60s cadence while mounted', async () => {
    const getFeeHistory = vi.fn().mockResolvedValue(feeHistoryFor(0n, 5n * GWEI));
    vi.mocked(createRpcClient).mockResolvedValue({ getFeeHistory } as never);

    renderHook(() => useGasHistory(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getFeeHistory).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getFeeHistory).toHaveBeenCalledTimes(2);

    // Not more often than the cadence.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getFeeHistory).toHaveBeenCalledTimes(2);
  });
});
