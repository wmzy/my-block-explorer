// Block-stream `watch` forwarding contract: a connected SSE client
// receives the WatchService's events for ITS chain as `watch` frames
// with the exact ring-buffer JSON shape, the per-connection subscription
// is released when the stream ends, and block-event semantics stay
// untouched (baseline head emits no block event). The RPC client and the
// WatchService are faked (streamRoutes.test.ts pattern); the payload
// literals mirror WatchService's shapers, whose wire contract is pinned
// in watchClient.test.ts against the real shapers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  subscribeChainEvents: vi.fn(),
  // The listener the route registered, once one exists.
  emit: null as ((event: unknown) => void) | null,
  // Live (subscribed, not yet released) per-connection count. A counter
  // rather than a single listener slot: the PREVIOUS test's stream loop
  // can still be inside its final stream.sleep when this test's fake
  // clock advances, and its unsubscribe would otherwise clobber a shared
  // slot mid-assertion.
  activeSubscriptions: 0,
  // Captured stream-routes logger.warn calls ({payload, message}) — the
  // queue-overflow warning is behavior under test.
  warns: [] as Array<{ payload: Record<string, unknown>; message: string }>,
}));

vi.mock('@/server/logger', () => ({
  createLogger: (module: string) => ({
    info: () => undefined,
    warn: (payload: Record<string, unknown>, message: string) => {
      if (module === 'stream-routes') mocks.warns.push({ payload, message });
    },
    error: () => undefined,
    debug: () => undefined,
  }),
}));

vi.mock('@/services/RpcManager', () => ({
  rpcManager: { getClient: mocks.getClient },
}));

vi.mock('@/services/WatchService', () => ({
  watchService: { subscribeChainEvents: mocks.subscribeChainEvents, start: vi.fn() },
}));

import app from '@/routes/stream';
import { resetRateLimiterState } from '@/middleware/rate-limit';

vi.useFakeTimers();

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

// The exact WatchFeedEvent wire shape (services/WatchService.ts).
const LOG_EVENT = {
  kind: 'log',
  chainId: 1,
  address: ADDRESS,
  blockNumber: '101',
  txHash: '0xtx0000000000000000000000000000000000000000000000000000000000001',
  logIndex: 2,
  topic0: '0xtopic00000000000000000000000000000000000000000000000000000000',
  message: null,
  at: '2026-09-23T10:00:00.000Z',
} as const;

const GAP_EVENT = {
  kind: 'gap',
  chainId: 1,
  address: ADDRESS,
  blockNumber: '95',
  txHash: null,
  logIndex: null,
  topic0: null,
  message: 'monitoring lagged; blocks 90–95 unchecked',
  at: '2026-09-23T10:00:00.000Z',
} as const;

const disposers = new Set<() => Promise<unknown>>();

const streamRequest = (path: string, signal?: AbortSignal) => {
  const promise = Promise.resolve(app.request(new Request(`http://localhost${path}`, { signal })));
  void promise.then((response: Response) => disposers.add(() => response.body!.cancel()));
  return promise;
};

function startReading(response: Response) {
  const reader = response.body!.getReader();
  disposers.add(() => reader.cancel());
  const decoder = new TextDecoder();
  let text = '';
  const reading = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  })().catch(() => undefined);
  return {
    text: () => text,
    finished: () => reading.then(() => text),
    cancel: () => reader.cancel(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimiterState();
  process.env.RATE_LIMIT_DISABLED = '1';
  mocks.warns.length = 0;
  mocks.emit = null;
  mocks.activeSubscriptions = 0;
  mocks.subscribeChainEvents.mockImplementation(
    (_chainId: number, listener: (event: unknown) => void) => {
      mocks.emit = listener;
      mocks.activeSubscriptions += 1;
      return () => {
        mocks.emit = null;
        mocks.activeSubscriptions -= 1;
      };
    },
  );
});

afterEach(async () => {
  for (const dispose of disposers) {
    try {
      await dispose();
    } catch {
      // Already closed — nothing to release.
    }
  }
  disposers.clear();
  // A cancelled stream's loop is still inside its final stream.sleep;
  // advance the fake clock so it wakes, sees the closed stream, and runs
  // its unsubscribe BEFORE the next test resets the shared counter.
  await vi.advanceTimersByTimeAsync(2_500);
  delete process.env.RATE_LIMIT_DISABLED;
});

describe('GET /chains/:chainId/blocks/stream — watch frames', () => {
  it('forwards WatchService events as `watch` frames with the exact ring-buffer JSON', async () => {
    mocks.getClient.mockResolvedValue({
      getBlockNumber: vi.fn().mockResolvedValue(100n), // quiet head
      getBlock: vi.fn(),
    });

    const response = await streamRequest('/chains/1/blocks/stream');
    expect(response.status).toBe(200);

    // The route subscribed this connection to chain 1's feed.
    expect(mocks.subscribeChainEvents).toHaveBeenCalledWith(1, expect.any(Function));

    const reading = startReading(response);
    await vi.advanceTimersByTimeAsync(1_200);

    // Two events for THIS chain arrive between loop cycles; the next
    // cycle flushes both, in production order.
    mocks.emit?.(LOG_EVENT);
    mocks.emit?.(GAP_EVENT);

    await vi.advanceTimersByTimeAsync(1_200);
    const text = reading.text();

    expect(text.match(/event: watch/g)).toHaveLength(2);

    const dataLines = text
      .split('\n')
      .filter(line => line.startsWith('data: '))
      .map(line => JSON.parse(line.slice('data: '.length)));
    // Same JSON shape the ring-buffer endpoint serves.
    expect(dataLines[0]).toEqual(LOG_EVENT);
    expect(dataLines[1]).toEqual(GAP_EVENT);

    // Block semantics untouched: the baseline head emitted no block event.
    expect(text).not.toContain('event: block');

    await reading.cancel();
    await reading.finished();
  });

  it('releases the watch subscription when the client aborts', async () => {
    const controller = new AbortController();
    mocks.getClient.mockResolvedValue({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getBlock: vi.fn(),
    });

    const response = await streamRequest('/chains/1/blocks/stream', controller.signal);
    const reading = startReading(response);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(mocks.activeSubscriptions).toBe(1); // subscription alive while open

    controller.abort();
    await vi.advanceTimersByTimeAsync(2_000);
    await reading.finished();
    expect(mocks.activeSubscriptions).toBe(0); // unsubscribed on close
  });

  it('does not subscribe the watch feed when the RPC client is unavailable', async () => {
    mocks.getClient.mockRejectedValue(new Error('no client'));
    const response = await streamRequest('/chains/1/blocks/stream');
    await startReading(response).finished();
    expect(mocks.subscribeChainEvents).not.toHaveBeenCalled();
  });

  it('caps the queued watch events at 1000 (drop-oldest) and warns once with the dropped count', async () => {
    mocks.getClient.mockResolvedValue({
      getBlockNumber: vi.fn().mockResolvedValue(100n), // quiet head
      getBlock: vi.fn(),
    });

    const response = await streamRequest('/chains/1/blocks/stream');
    const reading = startReading(response);
    await vi.advanceTimersByTimeAsync(1_200); // baseline set; loop sleeping

    // 1050 events arrive while the loop sleeps (a stalled consumer or a
    // slow catch-up batch): the queue holds only the NEWEST 1000.
    for (let i = 0; i < 1_050; i++) {
      mocks.emit?.({ ...LOG_EVENT, blockNumber: String(1_000 + i) });
    }
    await vi.advanceTimersByTimeAsync(1_200);

    const text = reading.text();
    // Exactly the cap was flushed — never an unbounded backlog burst.
    expect(text.match(/event: watch/g)).toHaveLength(1_000);

    // Drop-OLDEST: the survivors start at event #50 (the newest 1000).
    const firstData = text
      .split('\n')
      .find(line => line.startsWith('data: ')) as string;
    expect(JSON.parse(firstData.slice('data: '.length)).blockNumber).toBe('1050');

    // One warn for the whole overflow, carrying the dropped count — not
    // one per dropped event.
    expect(mocks.warns).toHaveLength(1);
    expect(mocks.warns[0]).toMatchObject({
      payload: { chainId: 1, dropped: 50, queueCap: 1_000 },
      message: expect.stringContaining('overflow'),
    });

    await reading.cancel();
    await reading.finished();
  });
});
