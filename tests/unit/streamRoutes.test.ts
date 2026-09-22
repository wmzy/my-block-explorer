// Block stream route contract: the SSE tail's event shape, the
// no-event-at-baseline rule (only genuinely NEW blocks are emitted),
// heartbeat comments on an idle stream, the explicit error event for an
// unknown chain, give-up after repeated head-poll failures, and a clean
// close on client abort. The RPC client is mocked — these tests pin the
// route wiring, not RPC semantics (mirroring signaturesRoutes.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
}));

vi.mock('@/services/RpcManager', () => ({
  rpcManager: { getClient: mocks.getClient },
}));

import app from '@/routes/stream';
import { resetRateLimiterState } from '@/middleware/rate-limit';

// Fake timers drive the route's poll cadence (stream.sleep uses
// setTimeout) and its Date.now()-based heartbeat clock.
vi.useFakeTimers();

const BLOCK_FIXTURE = {
  number: 101n,
  hash: '0xabc0000000000000000000000000000000000000000000000000000000000def',
  parentHash: '0xparent0000000000000000000000000000000000000000000000000000000d',
  timestamp: 1690000000n,
  miner: '0x1234567890abcdef1234567890abcdef12345678',
  gasUsed: 15_000_000n,
  gasLimit: 30_000_000n,
  size: 45_678n,
  baseFeePerGas: 1_500_000_000n,
  // Hashes-only form: includeTransactions defaults to false.
  transactions: [
    '0xtx100000000000000000000000000000000000000000000000000000000000001',
    '0xtx200000000000000000000000000000000000000000000000000000000000002',
  ],
};

const streamRequest = (path: string, signal?: AbortSignal) => {
  const promise = Promise.resolve(app.request(new Request(`http://localhost${path}`, { signal })));
  // Tests that never reach their explicit cancel still must not leak a
  // live poll loop into the next test (shared fake clock): every response
  // is tracked and its body cancelled in afterEach.
  void promise.then((response: Response) => disposers.add(() => response.body!.cancel()));
  return promise;
};

const disposers = new Set<() => Promise<unknown>>();

// Background drain of the SSE body: `text()` reads whatever the route has
// written so far (the stream may still be open); `finished()` resolves
// with the full text once the body ends (clean close or cancel).
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
});

afterEach(async () => {
  // Release any still-open stream body (through whichever reader holds
  // it) so no poll loop survives its test.
  for (const dispose of disposers) {
    try {
      await dispose();
    } catch {
      // Already closed — nothing to release.
    }
  }
  disposers.clear();
  delete process.env.RATE_LIMIT_DISABLED;
});

describe('GET /chains/:chainId/blocks/stream', () => {
  it('emits one block event per NEW block, never for the connect-time head', async () => {
    mocks.getClient.mockResolvedValue({
      getBlockNumber: vi.fn()
        .mockResolvedValueOnce(100n) // baseline at connect
        .mockResolvedValueOnce(101n) // the new block
        .mockResolvedValue(101n), // quiet head afterwards
      getBlock: vi.fn().mockResolvedValue(BLOCK_FIXTURE),
    });

    const response = await streamRequest('/chains/1/blocks/stream');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');

    const reading = startReading(response);
    await vi.advanceTimersByTimeAsync(2_000);
    const text = reading.text();

    // One event only: the baseline head (100) produces no event.
    expect(text.match(/event: block/g)).toHaveLength(1);

    const dataLine = text.split('\n').find(line => line.startsWith('data: '));
    expect(dataLine).toBeDefined();
    expect(JSON.parse(dataLine!.slice('data: '.length))).toEqual({
      number: '101',
      hash: BLOCK_FIXTURE.hash,
      parentHash: BLOCK_FIXTURE.parentHash,
      timestamp: '1690000000',
      miner: BLOCK_FIXTURE.miner,
      transactionCount: 2,
      gasUsed: '15000000',
      gasLimit: '30000000',
      baseFeePerGas: '1500000000',
      sizeBytes: 45678,
    });

    // Release the still-open stream.
    await reading.cancel();
    await reading.finished();
  });

  it('sends a heartbeat comment while the head is idle', async () => {
    mocks.getClient.mockResolvedValue({
      getBlockNumber: vi.fn().mockResolvedValue(100n), // never moves
      getBlock: vi.fn(),
    });

    const response = await streamRequest('/chains/1/blocks/stream');
    const reading = startReading(response);
    await vi.advanceTimersByTimeAsync(16_000);

    expect(reading.text()).toContain(': heartbeat');
    expect(reading.text()).not.toContain('event: block');
    await reading.cancel();
    await reading.finished();
  });

  it('answers an unknown chain with one error event, then closes', async () => {
    const response = await streamRequest('/chains/999999/blocks/stream');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');

    // Draining to done proves the stream CLOSED after the error event.
    const text = await startReading(response).finished();
    expect(text).toContain('event: error');
    const dataLine = text.split('\n').find(line => line.startsWith('data: '));
    const payload = JSON.parse(dataLine!.slice('data: '.length));
    expect(payload.error).toBe('invalid_chain');
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it('answers a missing RPC client with one error event, then closes', async () => {
    mocks.getClient.mockRejectedValue(new Error('no client'));

    const response = await streamRequest('/chains/1/blocks/stream');
    const text = await startReading(response).finished();
    expect(text).toContain('event: error');
    const dataLine = text.split('\n').find(line => line.startsWith('data: '));
    expect(JSON.parse(dataLine!.slice('data: '.length)).error).toBe('rpc_unavailable');
  });

  it('gives up with an error event after repeated head-poll failures', async () => {
    mocks.getClient.mockResolvedValue({
      getBlockNumber: vi.fn().mockRejectedValue(new Error('rpc down')),
      getBlock: vi.fn(),
    });

    const response = await streamRequest('/chains/1/blocks/stream');
    const reading = startReading(response);
    // Ten consecutive 1s-spaced failures: 10 fake seconds of clock.
    await vi.advanceTimersByTimeAsync(12_000);
    const text = await reading.finished();

    expect(text).toContain('event: error');
    const dataLine = text.split('\n').find(line => line.startsWith('data: '));
    expect(JSON.parse(dataLine!.slice('data: '.length)).error).toBe('rpc_failed');
  });

  it('closes cleanly when the client aborts', async () => {
    const controller = new AbortController();
    mocks.getClient.mockResolvedValue({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getBlock: vi.fn(),
    });

    const response = await streamRequest('/chains/1/blocks/stream', controller.signal);
    const reading = startReading(response);
    await vi.advanceTimersByTimeAsync(3_000);
    // Still streaming (baseline only — no events) before the abort.
    expect(reading.text()).not.toContain('event: block');

    controller.abort();
    await vi.advanceTimersByTimeAsync(5_000);
    const text = await reading.finished();

    // The loop exited and the body ended; nothing was written post-abort.
    expect(text).not.toContain('event: block');
  });

  it('caps the catch-up batch after a long stall', async () => {
    const getBlockNumber = vi.fn()
      .mockResolvedValueOnce(100n) // baseline
      .mockResolvedValueOnce(115n) // 15-block gap after the stall
      .mockResolvedValue(115n);
    const getBlock = vi.fn().mockImplementation(({ blockNumber }: { blockNumber: bigint }) =>
      Promise.resolve({ ...BLOCK_FIXTURE, number: blockNumber }),
    );
    mocks.getClient.mockResolvedValue({ getBlockNumber, getBlock });

    const response = await streamRequest('/chains/1/blocks/stream');
    const reading = startReading(response);
    await vi.advanceTimersByTimeAsync(2_000);

    // 15 missed blocks, but only the newest 10 are emitted.
    const numbers = [...reading.text().matchAll(/"number":"(\d+)"/g)].map(m => Number(m[1]));
    expect(numbers).toHaveLength(10);
    expect(Math.min(...numbers)).toBe(106); // head 115 minus 9
    expect(Math.max(...numbers)).toBe(115);

    await reading.cancel();
    await reading.finished();
  });

  it('rate-limits stream creation beyond the burst', async () => {
    delete process.env.RATE_LIMIT_DISABLED;
    resetRateLimiterState();
    mocks.getClient.mockResolvedValue({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getBlock: vi.fn(),
    });

    const controllers: AbortController[] = [];
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const controller = new AbortController();
      controllers.push(controller);
      const response = await streamRequest('/chains/1/blocks/stream', controller.signal);
      statuses.push(response.status);
    }

    // Burst is 6: the 7th concurrent stream is refused with 429 (which the
    // frontend EventSource turns into the silent polling fallback).
    expect(statuses.slice(0, 6)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(statuses[6]).toBe(429);

    for (const controller of controllers) controller.abort();
  });
});
