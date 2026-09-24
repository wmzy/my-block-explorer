// Client watch-feed contract: subscribeWatchEvents rides the SAME shared
// EventSource as the block stream (one connection per chain, closed with
// the last subscriber), `watch` frames parse tolerantly (malformed JSON
// and wrong shapes are dropped whole; unknown event names simply have no
// listener), and the SSE payload roundtrip holds — the REAL server
// shapers' JSON survives the client guard unchanged (db and RpcManager
// stubbed so the real WatchService module loads without IO). Also pins
// watchEventKey (the notification/feed dedupe key).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { setApiBase } from '@/util/apiBase';
import type { LiveBlockPayload, LiveWatchEvent } from '@/services/liveChain';

vi.mock('@/database/drizzle', () => ({ db: {} }));
vi.mock('@/services/RpcManager', () => ({ rpcManager: {} }));

import {
  subscribeWatchEvents,
  subscribeLiveBlockEvents,
  useWatchEvents,
  isLiveWatchEvent,
} from '@/services/liveChain';
import { watchEventKey } from '@/services/watch';
import { shapeLogEvent, gapMarkerEvent } from '@/services/WatchService';

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

  emit(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }

  // Prove unknown event names are simply unheard: nobody subscribed.
  heardEventNames(): string[] {
    return [...this.listeners.keys()];
  }
}

const blockPayload = (number: number): LiveBlockPayload => ({
  number: String(number),
  hash: `0x${number.toString(16).padStart(64, '0')}`,
  parentHash: `0x${(number - 1).toString(16).padStart(64, '0')}`,
  timestamp: '1690000000',
  miner: '0x1234567890abcdef1234567890abcdef12345678',
  transactionCount: 3,
  gasUsed: '1000000',
  gasLimit: '30000000',
});

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  FakeEventSource.instances = [];
  localStorage.clear();
  setApiBase('');
});

afterEach(() => {
  vi.unstubAllGlobals();
  setApiBase('');
});

describe('subscribeWatchEvents', () => {
  it('never opens a connection without a discovered API base', () => {
    const events: LiveWatchEvent[] = [];
    const unsubscribe = subscribeWatchEvents(1, event => events.push(event));
    expect(FakeEventSource.instances).toHaveLength(0);
    unsubscribe();
  });

  it('shares the block stream’s connection and closes it with the last subscriber', () => {
    setApiBase('http://localhost:8201');
    const unsubscribeBlock = subscribeLiveBlockEvents(1, () => undefined);
    const unsubscribeWatch = subscribeWatchEvents(1, () => undefined);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe(
      'http://localhost:8201/api/chains/1/blocks/stream',
    );

    unsubscribeBlock();
    expect(FakeEventSource.instances[0].closed).toBe(false);
    unsubscribeWatch();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it('delivers valid `watch` frames to every listener, dropping malformed ones', () => {
    setApiBase('http://localhost:8201');
    const seen: LiveWatchEvent[] = [];
    const seenB: LiveWatchEvent[] = [];
    const unsubscribeA = subscribeWatchEvents(1, event => seen.push(event));
    const unsubscribeB = subscribeWatchEvents(1, event => seenB.push(event));

    const source = FakeEventSource.instances[0];
    const logEvent = shapeLogEvent(1, ADDRESS, {
      address: ADDRESS,
      topics: ['0xtopic00000000000000000000000000000000000000000000000000000000'],
      data: '0x',
      blockNumber: 101n,
      transactionHash: '0xtx0000000000000000000000000000000000000000000000000000000000001',
      transactionIndex: 0,
      blockHash: '0xblockhash0000000000000000000000000000000000000000000000000000a',
      logIndex: 2,
      removed: false,
    });
    const gapEvent = gapMarkerEvent(1, ADDRESS, 90n, 95n);

    source.emit('watch', JSON.stringify(logEvent));
    source.emit('watch', JSON.stringify(gapEvent));
    source.emit('watch', 'not json');
    source.emit('watch', JSON.stringify({ kind: 'log', chainId: 1 })); // wrong shape
    source.emit('watch', JSON.stringify({ ...logEvent, logIndex: '2' })); // wrong type

    expect(seen.map(e => e.kind)).toEqual(['log', 'gap']);
    expect(seen).toEqual([logEvent, gapEvent]);
    expect(seenB).toEqual(seen);

    unsubscribeA();
    unsubscribeB();
  });

  it('ignores event names it does not know (tolerant unknown-event contract)', () => {
    setApiBase('http://localhost:8201');
    const seen: LiveWatchEvent[] = [];
    const unsubscribe = subscribeWatchEvents(1, event => seen.push(event));
    const source = FakeEventSource.instances[0];

    // A newer backend could name other events; unheard names never reach
    // any listener. The manager subscribes exactly the names it knows:
    // block + watch frames, plus the server's terminal `error` event.
    expect(source.heardEventNames().sort()).toEqual(['block', 'error', 'watch']);
    source.emit('fancy-new-event', JSON.stringify({ whatever: true }));
    expect(seen).toEqual([]);

    unsubscribe();
  });

  it('keeps watch delivery independent of the block feed', () => {
    setApiBase('http://localhost:8201');
    const blocks: LiveBlockPayload[] = [];
    const events: LiveWatchEvent[] = [];
    const unsubscribeBlock = subscribeLiveBlockEvents(1, block => blocks.push(block));
    const unsubscribeWatch = subscribeWatchEvents(1, event => events.push(event));

    const source = FakeEventSource.instances[0];
    source.emit('block', JSON.stringify(blockPayload(100)));
    source.emit('watch', JSON.stringify(gapMarkerEvent(1, ADDRESS, 1n, 2n)));

    expect(blocks.map(b => b.number)).toEqual(['100']);
    expect(events.map(e => e.kind)).toEqual(['gap']);

    unsubscribeBlock();
    unsubscribeWatch();
  });
});

describe('useWatchEvents hook', () => {
  it('exposes watch events to components with latest-callback semantics', () => {
    setApiBase('http://localhost:8201');
    const seen: string[] = [];
    const { unmount } = renderHook(() => useWatchEvents(1, event => seen.push(event.kind)));

    act(() => {
      FakeEventSource.instances[0].emit('watch', JSON.stringify(gapMarkerEvent(1, ADDRESS, 1n, 2n)));
    });
    expect(seen).toEqual(['gap']);

    unmount();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});

describe('SSE payload roundtrip (server shaper → wire → client guard)', () => {
  it('roundtrips a log event: JSON of the real shaper survives the client guard', () => {
    const at = new Date('2026-09-23T10:00:00.000Z');
    const shaped = shapeLogEvent(
      137,
      ADDRESS,
      {
        address: ADDRESS,
        topics: ['0xtopic00000000000000000000000000000000000000000000000000000000'],
        data: '0x',
        blockNumber: 19_000_001n,
        transactionHash: '0xtx2000000000000000000000000000000000000000000000000000000000002',
        transactionIndex: 4,
        blockHash: '0xblockhash0000000000000000000000000000000000000000000000000000b',
        logIndex: 11,
        removed: false,
      },
      at,
    );

    const wire = JSON.parse(JSON.stringify(shaped)) as unknown;
    expect(isLiveWatchEvent(wire)).toBe(true);
    expect(wire).toEqual(shaped);
  });

  it('roundtrips a gap marker (null ids and all)', () => {
    const shaped = gapMarkerEvent(1, ADDRESS, 501n, 9_800n, new Date(0));
    const wire = JSON.parse(JSON.stringify(shaped)) as unknown;
    expect(isLiveWatchEvent(wire)).toBe(true);
    expect(wire).toEqual(shaped);
  });

  it('rejects shapes the guard does not know', () => {
    expect(isLiveWatchEvent(null)).toBe(false);
    expect(isLiveWatchEvent('watch')).toBe(false);
    expect(isLiveWatchEvent({ kind: 'transfer' })).toBe(false);
    expect(isLiveWatchEvent({ kind: 'log', chainId: '1' })).toBe(false);
  });
});

describe('watchEventKey — dedupe key', () => {
  it('keys log events by chain+txHash+logIndex', () => {
    const event = shapeLogEvent(1, ADDRESS, {
      address: ADDRESS,
      topics: [],
      data: '0x',
      blockNumber: 1n,
      transactionHash: '0xtx9000000000000000000000000000000000000000000000000000000000009',
      transactionIndex: 0,
      blockHash: '0xblockhash0000000000000000000000000000000000000000000000000000c',
      logIndex: 3,
      removed: false,
    });
    expect(watchEventKey(event)).toBe(
      '1:0xtx9000000000000000000000000000000000000000000000000000000000009:3',
    );
  });

  it('keys gap markers per chain+address+block and never collides with a log key', () => {
    const gap = gapMarkerEvent(1, ADDRESS, 90n, 95n);
    expect(watchEventKey(gap)).toBe(`1:gap:${ADDRESS}:95`);
    expect(watchEventKey(gap)).not.toContain('undefined');
  });
});
