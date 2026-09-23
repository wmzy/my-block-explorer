// Txpool service: pure flatten/sort/cap helpers plus the fetch/hook layer.
// The only network edge is the shared viem client factory, mocked
// throughout — no test here touches a real RPC.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import {
  TXPOOL_DISPLAY_CAP,
  buildPoolSnapshot,
  fetchPendingTransactions,
  isTxPoolUnsupportedError,
  usePendingTransactions,
} from '@/services/txpool';
import { clearAllCaches } from '@/util/useQuery';
import { createRpcClient } from '@/utils/realTimeData';

vi.mock('@/utils/realTimeData', () => ({ createRpcClient: vi.fn() }));

const ONE_ETHER = 1_000_000_000_000_000_000n;
const ONE_GWEI = 1_000_000_000n;
const TWO_GWEI = 2_000_000_000n;

// A well-formed raw Geth tx (legacy pricing by default); overrides patch
// individual fields.
const rawTx = (overrides: Record<string, unknown> = {}) => ({
  hash: '0xtx',
  from: '0xfrom',
  to: '0xto',
  value: `0x${ONE_ETHER.toString(16)}`,
  gas: '0x5208',
  gasPrice: '0x3b9aca00',
  nonce: '0x0',
  ...overrides,
});

// --- flattening ---

describe('buildPoolSnapshot', () => {
  it('flattens the account→nonce maps with both key layers carried through', () => {
    const snapshot = buildPoolSnapshot({
      pending: {
        '0xB': { 7: rawTx({ hash: '0xb7', nonce: '0x7' }) },
        '0xAa': {
          0: rawTx({ hash: '0xa0', nonce: '0x0' }),
          1: rawTx({ hash: '0xa1', nonce: '0x1' }),
        },
      },
      queued: { '0xCc': { 5: rawTx({ hash: '0xc5' }) } },
    });

    expect(snapshot.pendingCount).toBe(3);
    expect(snapshot.queuedCount).toBe(1);
    expect(snapshot.truncated).toBe(false);

    // Order: '0xaa' < '0xb' case-insensitively, then account nonce asc.
    expect(snapshot.pending.map(e => [e.account, e.accountNonce])).toEqual([
      ['0xAa', 0],
      ['0xAa', 1],
      ['0xB', 7],
    ]);
    const first = snapshot.pending[0];
    expect(first.hash).toBe('0xa0');
    expect(first.value).toBe(ONE_ETHER);
    expect(first.nonce).toBe(0);
    expect(first.gasPrice).toBe(ONE_GWEI);
  });

  it('preserves to:null (contract creation) and keeps maxFeePerGas only when the tx had it', () => {
    const eip1559 = {
      hash: '0x1559',
      from: '0xfrom',
      to: null,
      value: '0x0',
      gas: '0x5208',
      maxFeePerGas: '0x77359400',
      maxPriorityFeePerGas: '0x3b9aca00',
      nonce: '0x0',
    };
    const snapshot = buildPoolSnapshot({
      pending: { '0xA': { 0: eip1559, 1: rawTx({ hash: '0xlegacy', nonce: '0x1' }) } },
    });

    const [tx1559, legacy] = snapshot.pending;
    expect(tx1559.to).toBeNull();
    expect(tx1559.maxFeePerGas).toBe(TWO_GWEI);
    expect(tx1559.gasPrice).toBeUndefined();
    expect(legacy.to).toBe('0xto');
    expect(legacy.gasPrice).toBe(ONE_GWEI);
    expect(legacy.maxFeePerGas).toBeUndefined();
  });

  it('orders out-of-order pools by account (case-insensitive, raw-string tiebreak) then nonce', () => {
    const snapshot = buildPoolSnapshot({
      pending: {
        // Insertion order deliberately scrambled; '0xAAA' vs '0xaaa'
        // differ only by case, so the raw-string tiebreak decides ('A' < 'a').
        '0xzz': { 0: rawTx({ hash: '0xz0' }) },
        '0xAAA': { 1: rawTx({ hash: '0xA1', nonce: '0x1' }) },
        '0xbb': {
          9: rawTx({ hash: '0xb9', nonce: '0x9' }),
          2: rawTx({ hash: '0xb2', nonce: '0x2' }),
        },
        '0xaaa': { 0: rawTx({ hash: '0xa0' }) },
      },
    });

    expect(snapshot.pending.map(e => [e.account, e.accountNonce])).toEqual([
      ['0xAAA', 1],
      ['0xaaa', 0],
      ['0xbb', 2],
      ['0xbb', 9],
      ['0xzz', 0],
    ]);
  });

  it('caps the listing at TXPOOL_DISPLAY_CAP while keeping the true count and the full queued count', () => {
    const pending: Record<string, Record<string, unknown>> = {};
    let hashCounter = 0;
    for (let account = 0; account < 3; account += 1) {
      const byNonce: Record<string, unknown> = {};
      for (let nonce = 0; nonce < 90; nonce += 1) {
        hashCounter += 1;
        byNonce[String(nonce)] = rawTx({
          hash: `0x${hashCounter.toString(16)}`,
          nonce: `0x${nonce.toString(16)}`,
        });
      }
      pending[`0xacc${account}`] = byNonce;
    }
    // 3 accounts × 90 nonces = 270 pending > cap; queued adds 4 more.
    const snapshot = buildPoolSnapshot({
      pending,
      queued: {
        '0xq1': { 0: rawTx(), 1: rawTx() },
        '0xq2': { 3: rawTx(), 4: rawTx() },
      },
    });

    expect(snapshot.pending).toHaveLength(TXPOOL_DISPLAY_CAP);
    expect(snapshot.pendingCount).toBe(270);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.queuedCount).toBe(4);
    // The cap keeps the deterministic head of the order, not a random slice.
    expect(snapshot.pending[0]).toMatchObject({ account: '0xacc0', accountNonce: 0 });
    expect(snapshot.pending[199]).toMatchObject({ account: '0xacc2', accountNonce: 19 });
  });

  it('reads an entirely empty pool (Geth omits the maps) as 0/0, not a failure', () => {
    const empty = { pending: [], pendingCount: 0, queuedCount: 0, truncated: false };
    expect(buildPoolSnapshot({})).toEqual(empty);
    expect(buildPoolSnapshot({ pending: {}, queued: {} })).toEqual(empty);
  });

  it('skips malformed entries and keeps their siblings', () => {
    const snapshot = buildPoolSnapshot({
      pending: {
        '0xA': {
          0: rawTx({ hash: '0xkeep' }),
          1: { from: '0xfrom', value: '0x1', nonce: '0x1' }, // no hash
          2: { hash: '0xh', value: '0x1', nonce: '0x2' }, // no from
          3: rawTx({ hash: '0xbadvalue', value: 'not-hex' }), // unparseable value
          4: rawTx({ hash: '0xbadnonce', nonce: 'zz' }), // unparseable nonce
        },
        '0xB': { 'not-a-nonce': rawTx({ hash: '0xbadkey' }) }, // non-decimal key
        '0xC': 5, // not a nonce map at all
      },
      queued: { '0xQ': { 0: { value: '0x1' } } }, // no hash/from → not counted
    });

    expect(snapshot.pendingCount).toBe(1);
    expect(snapshot.pending[0].hash).toBe('0xkeep');
    expect(snapshot.queuedCount).toBe(0);
  });
});

// --- failure classification ---

describe('isTxPoolUnsupportedError', () => {
  it('recognizes the txpool_* refusal phrasings', () => {
    expect(isTxPoolUnsupportedError(new Error('Method not found'))).toBe(true);
    expect(isTxPoolUnsupportedError('the method txpool_content does not exist/is not available')).toBe(true);
    expect(isTxPoolUnsupportedError(new Error('txpool_content is not supported'))).toBe(true);
  });

  it('walks wrapped causes and bare -32601 code objects', () => {
    expect(
      isTxPoolUnsupportedError(
        new Error('HTTP request failed', {
          cause: new Error('Method not found: txpool_content'),
        }),
      ),
    ).toBe(true);
    expect(isTxPoolUnsupportedError({ code: -32601 })).toBe(true);
  });

  it('does not read transport failures or bare "not found" as unsupported', () => {
    expect(isTxPoolUnsupportedError(new Error('fetch failed'))).toBe(false);
    expect(isTxPoolUnsupportedError(new Error('tx 0xabc not found'))).toBe(false);
  });
});

// --- fetch layer (mocked viem client) ---

describe('fetchPendingTransactions', () => {
  const request = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createRpcClient).mockResolvedValue({ request } as never);
  });

  it('asks for txpool_content with no params', async () => {
    request.mockResolvedValue({});

    await fetchPendingTransactions(1);

    expect(request).toHaveBeenCalledWith({ method: 'txpool_content', params: [] });
  });

  it('treats a 200 with a non-object body as a failure, not an empty pool', async () => {
    for (const garbage of [[], 'nope', 42, null]) {
      request.mockResolvedValue(garbage);

      await expect(fetchPendingTransactions(1)).resolves.toEqual({
        status: 'failed',
        chainId: 1,
        message: 'txpool_content returned an unexpected shape',
      });
    }
  });

  it('settles an empty pool (maps absent) as ok with 0/0', async () => {
    request.mockResolvedValue({});

    await expect(fetchPendingTransactions(1)).resolves.toEqual({
      status: 'ok',
      chainId: 1,
      pending: [],
      pendingCount: 0,
      queuedCount: 0,
      truncated: false,
    });
  });

  it('settles the unsupported state for method-not-found refusals', async () => {
    request.mockRejectedValue(new Error('Method not found'));

    await expect(fetchPendingTransactions(1)).resolves.toEqual({
      status: 'unsupported',
      chainId: 1,
      message: 'This RPC does not expose the transaction pool (txpool_* is not supported)',
    });
  });

  it('classifies wrapped-cause and bare -32601 rejections as unsupported too', async () => {
    request.mockRejectedValueOnce(
      new Error('HTTP request failed', {
        cause: new Error('the method txpool_content does not exist/is not available'),
      }),
    );
    request.mockRejectedValueOnce({ code: -32601 });

    for (let rejection = 0; rejection < 2; rejection += 1) {
      await expect(fetchPendingTransactions(1)).resolves.toMatchObject({
        status: 'unsupported',
        chainId: 1,
        message: 'This RPC does not expose the transaction pool (txpool_* is not supported)',
      });
    }
  });

  it('settles a failed state with a static message for transport errors', async () => {
    request.mockRejectedValue(new Error('fetch failed'));

    await expect(fetchPendingTransactions(1)).resolves.toEqual({
      status: 'failed',
      chainId: 1,
      message: 'Failed to fetch the transaction pool',
    });
  });

  it('does not hang forever on a black-holed txpool_content (request budget)', async () => {
    // Some providers accept the POST but never answer it; the page must
    // leave its first-load skeleton and settle the honest failed state.
    request.mockImplementation(() => new Promise(() => undefined));

    vi.useFakeTimers();
    try {
      const pending = fetchPendingTransactions(1);
      // Resolve the microtask queue up to (but not past) the budget.
      await vi.advanceTimersByTimeAsync(7_999);
      // Not settled yet at the boundary… settle it now.
      const settled = vi.advanceTimersByTimeAsync(1).then(() => pending);
      await expect(settled).resolves.toEqual({
        status: 'failed',
        chainId: 1,
        message: 'Failed to fetch the transaction pool',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('classifies a client-creation failure too', async () => {
    vi.mocked(createRpcClient).mockRejectedValue(new Error('all transports down'));

    await expect(fetchPendingTransactions(1)).resolves.toEqual({
      status: 'failed',
      chainId: 1,
      message: 'Failed to fetch the transaction pool',
    });
  });

  it('never touches an endpoint for a non-positive or non-finite chain id', async () => {
    for (const chainId of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(fetchPendingTransactions(chainId)).resolves.toEqual({
        status: 'failed',
        chainId,
        message: 'Unknown chain',
      });
    }
    expect(createRpcClient).not.toHaveBeenCalled();
  });
});

// --- polled hook ---

describe('usePendingTransactions', () => {
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

  it('settles the pool and re-fetches on the 5s cadence while mounted', async () => {
    const request = vi.fn().mockResolvedValue({
      pending: { '0xA': { 0: rawTx({ hash: '0xa0' }) } },
      queued: {},
    });
    vi.mocked(createRpcClient).mockResolvedValue({ request } as never);

    const { result } = renderHook(() => usePendingTransactions(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ method: 'txpool_content', params: [] });
    expect(result.current.data?.status).toBe('ok');
    if (result.current.data?.status === 'ok') {
      expect(result.current.data.pendingCount).toBe(1);
      expect(result.current.data.pending[0].hash).toBe('0xa0');
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(request).toHaveBeenCalledTimes(2);

    // Not more often than the cadence.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(request).toHaveBeenCalledTimes(2);

    // A full minute from mount: the initial fetch plus 12 five-second ticks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(53_000);
    });
    expect(request).toHaveBeenCalledTimes(13);
  });
});
