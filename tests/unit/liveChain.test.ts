// liveChain contract: the shared EventSource manager (open only with a
// discovered API base, one connection per chain shared by subscribers),
// the silent live→polling fallback on stream error, block dedupe (no
// listener ever sees the same block twice), and the pure polled+live
// merge the Home list renders. EventSource is faked end to end.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { setApiBase } from '@/util/apiBase';
import {
  subscribeLiveChain,
  subscribeLiveBlockEvents,
  useLiveBlocks,
  useLiveBlockEvents,
  mergeLiveBlocks,
  liveBlockToRpcBlock,
  LIVE_BLOCK_WINDOW,
  type LiveBlockPayload,
} from '@/services/liveChain';

type SSEListener = (event: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  private listeners = new Map<string, Set<SSEListener>>();
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: SSEListener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  close() {
    this.closed = true;
  }

  // Test helpers: deliver a server frame / fail the connection.
  emit(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }

  fail() {
    this.onerror?.();
  }
}

const payload = (number: number, extra: Partial<LiveBlockPayload> = {}): LiveBlockPayload => ({
  number: String(number),
  hash: `0x${number.toString(16).padStart(64, '0')}`,
  parentHash: `0x${(number - 1).toString(16).padStart(64, '0')}`,
  timestamp: '1690000000',
  miner: '0x1234567890abcdef1234567890abcdef12345678',
  transactionCount: 3,
  gasUsed: '1000000',
  gasLimit: '30000000',
  baseFeePerGas: '1500000000',
  sizeBytes: 12345,
  ...extra,
});

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  FakeEventSource.instances = [];
  localStorage.clear();
  setApiBase('');
  vi.mocked(console.warn)?.mockClear?.();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setApiBase('');
});

describe('liveChain manager', () => {
  it('never opens a connection without a discovered API base', () => {
    const states: string[] = [];
    const unsubscribe = subscribeLiveChain(1, state => states.push(state.mode));

    expect(states).toEqual(['polling']);
    expect(FakeEventSource.instances).toHaveLength(0);
    unsubscribe();
  });

  it('opens one shared connection per chain, reusing it across subscribers', () => {
    setApiBase('http://localhost:8201');
    const stateUnsubscribe = subscribeLiveChain(1, () => undefined);
    const blockUnsubscribe = subscribeLiveBlockEvents(1, () => undefined);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe(
      'http://localhost:8201/api/chains/1/blocks/stream',
    );

    // Dropping one subscriber keeps the shared stream alive; the last one
    // closes it.
    stateUnsubscribe();
    expect(FakeEventSource.instances[0].closed).toBe(false);
    blockUnsubscribe();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it('separates chains, and a non-positive chain id never connects', () => {
    setApiBase('http://localhost:8201');
    const unsubscribeA = subscribeLiveChain(1, () => undefined);
    const unsubscribeB = subscribeLiveChain(137, () => undefined);
    const unsubscribeParked = subscribeLiveChain(0, () => undefined);

    expect(FakeEventSource.instances.map(i => i.url)).toEqual([
      'http://localhost:8201/api/chains/1/blocks/stream',
      'http://localhost:8201/api/chains/137/blocks/stream',
    ]);
    unsubscribeA();
    unsubscribeB();
    unsubscribeParked();
  });

  it('goes live only when a pushed block actually arrives', () => {
    setApiBase('http://localhost:8201');
    const states: string[] = [];
    const unsubscribe = subscribeLiveChain(1, state => states.push(state.mode));

    expect(states).toEqual(['polling']); // open-but-silent is still polling
    FakeEventSource.instances[0].emit('block', JSON.stringify(payload(100)));
    expect(states).toEqual(['polling', 'live']);

    unsubscribe();
  });

  it('falls back silently (and permanently) to polling on stream error', () => {
    setApiBase('http://localhost:8201');
    const states: string[] = [];
    const unsubscribe = subscribeLiveChain(1, state => states.push(state.mode));
    const source = FakeEventSource.instances[0];
    source.emit('block', JSON.stringify(payload(100)));

    source.fail();

    expect(states[states.length - 1]).toBe('polling');
    expect(source.closed).toBe(true);
    // One honest trace, no error surface.
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('falling back to polling'));

    // The same base never re-opens: even a fresh apiBase listener cycle
    // with the identical value is a no-op, and a NEW subscription on the
    // same chain does not resurrect the failed stream... it creates a new
    // entry — that is a new mount generation, which SHOULD retry.
    const before = FakeEventSource.instances.length;
    setApiBase('http://localhost:8201'); // idempotent: no change event
    expect(FakeEventSource.instances).toHaveLength(before);

    unsubscribe();
  });

  it('re-opens when the API base changes after an error', () => {
    setApiBase('http://localhost:8201');
    const unsubscribe = subscribeLiveChain(1, () => undefined);
    FakeEventSource.instances[0].fail();

    // Discovery later lands on a different backend: a genuinely new world.
    setApiBase('http://localhost:8205');
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1].url).toBe(
      'http://localhost:8205/api/chains/1/blocks/stream',
    );

    unsubscribe();
    expect(FakeEventSource.instances[1].closed).toBe(true);
  });

  it('opens late once discovery completes after mount', () => {
    const unsubscribe = subscribeLiveChain(1, () => undefined);
    expect(FakeEventSource.instances).toHaveLength(0);

    setApiBase('http://localhost:8201');
    expect(FakeEventSource.instances).toHaveLength(1);

    unsubscribe();
  });

  it('closes streams and downgrades when the API base disappears', () => {
    setApiBase('http://localhost:8201');
    const states: string[] = [];
    const unsubscribe = subscribeLiveChain(1, state => states.push(state.mode));
    FakeEventSource.instances[0].emit('block', JSON.stringify(payload(100)));
    expect(states[states.length - 1]).toBe('live');

    setApiBase('');
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(states[states.length - 1]).toBe('polling');

    unsubscribe();
  });

  it('ignores malformed frames', () => {
    setApiBase('http://localhost:8201');
    const blocks: LiveBlockPayload[] = [];
    const unsubscribe = subscribeLiveBlockEvents(1, block => blocks.push(block));

    const source = FakeEventSource.instances[0];
    source.emit('block', 'not json');
    source.emit('block', JSON.stringify({ number: 'soon', hash: '0x1' })); // wrong shape
    source.emit('block', JSON.stringify(payload(100)));

    expect(blocks.map(b => b.number)).toEqual(['100']);

    unsubscribe();
  });

  it('delivers each block to every listener exactly once (dedupe)', () => {
    setApiBase('http://localhost:8201');
    const seen: string[] = [];
    const seenA: string[] = [];
    const unsubscribeState = subscribeLiveChain(1, () => undefined);
    const unsubscribeBlocks = subscribeLiveBlockEvents(1, block => seen.push(block.number));
    const unsubscribeA = subscribeLiveBlockEvents(1, block => seenA.push(block.number));

    const source = FakeEventSource.instances[0];
    source.emit('block', JSON.stringify(payload(100)));
    source.emit('block', JSON.stringify(payload(100))); // exact re-delivery
    source.emit('block', JSON.stringify({ ...payload(100), hash: '0xother' })); // same number

    expect(seen).toEqual(['100']);
    expect(seenA).toEqual(['100']);

    unsubscribeState();
    unsubscribeBlocks();
    unsubscribeA();
  });

  it('keeps a newest-first rolling window, dropping old entries', () => {
    setApiBase('http://localhost:8201');
    let latest: LiveBlockPayload[] = [];
    const unsubscribe = subscribeLiveChain(1, state => {
      latest = state.blocks;
    });

    const source = FakeEventSource.instances[0];
    for (let n = 100; n < 100 + LIVE_BLOCK_WINDOW + 5; n++) {
      source.emit('block', JSON.stringify(payload(n)));
    }

    expect(latest.map(b => Number(b.number))).toEqual(
      [...Array(LIVE_BLOCK_WINDOW).keys()].map(i => 100 + LIVE_BLOCK_WINDOW + 4 - i),
    );

    unsubscribe();
  });
});

describe('useLiveBlocks / useLiveBlockEvents hooks', () => {
  it('exposes the shared state and per-block events to components', () => {
    setApiBase('http://localhost:8201');
    const seen: string[] = [];
    const { result, unmount } = renderHook(() => {
      useLiveBlockEvents(1, block => seen.push(block.number));
      return useLiveBlocks(1);
    });

    expect(result.current.mode).toBe('polling');

    act(() => {
      FakeEventSource.instances[0].emit('block', JSON.stringify(payload(100)));
    });
    expect(result.current.mode).toBe('live');
    expect(result.current.blocks.map(b => b.number)).toEqual(['100']);
    expect(seen).toEqual(['100']);

    // Fallback transition reaches the hook too.
    act(() => {
      FakeEventSource.instances[0].fail();
    });
    expect(result.current.mode).toBe('polling');

    unmount();
  });
});

describe('mergeLiveBlocks (pure)', () => {
  const feedBlock = (number: number) => liveBlockToRpcBlock(payload(number));

  it('prepends live blocks to the polled list, deduped by number', () => {
    const feed = [feedBlock(98), feedBlock(97), feedBlock(96)];
    const live = [payload(100), payload(99), payload(98)];

    const merged = mergeLiveBlocks(feed, live, 10);
    expect(merged.map(b => b.number)).toEqual(['100', '99', '98', '97', '96']);
  });

  it('keeps a polled head that is momentarily newer than the stream', () => {
    const feed = [feedBlock(101), feedBlock(100)];
    const live = [payload(100)];

    const merged = mergeLiveBlocks(feed, live, 10);
    expect(merged.map(b => b.number)).toEqual(['101', '100']);
  });

  it('caps the merged list and lets live entries win same-number ties', () => {
    const feed = [feedBlock(99), feedBlock(98), feedBlock(97)];
    const live = [payload(99)];

    const merged = mergeLiveBlocks(feed, live, 3);
    expect(merged).toHaveLength(3);
    expect(merged.map(b => b.number)).toEqual(['99', '98', '97']);
    // The live read of block 99 (txCount 3) replaced the feed's row.
    expect(merged[0].transactionCount).toBe(3);
  });

  it('returns the feed unchanged when the live window is empty', () => {
    const feed = [feedBlock(98), feedBlock(97)];
    expect(mergeLiveBlocks(feed, [], 10)).toEqual(feed);
  });
});
