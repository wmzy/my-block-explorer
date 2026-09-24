// WatchService pure-part contract: the scan planner (gap-cap math),
// the event shapers (bigint → decimal string, gap-marker copy), the ring
// buffer (newest-first, capacity eviction) and the row→view shaping.
// The db and RpcManager modules are stubbed so the real module loads
// without any IO (its pure helpers are the test target; the interval
// only starts via start(), which these tests never call).
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/database/drizzle', () => ({ db: {} }));
vi.mock('@/services/RpcManager', () => ({ rpcManager: {} }));

import {
  WatchEventRing,
  gapMarkerEvent,
  planSubscriptionScan,
  shapeLogEvent,
  toSubscriptionView,
  WATCH_GAP_BLOCK_CAP,
  WATCH_RING_CAPACITY,
} from '@/services/WatchService';
import type { Log } from 'viem';

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678' as const;

const logFixture = (over: Partial<Log> = {}): Log =>
  ({
    address: ADDRESS,
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    ],
    data: '0x',
    blockNumber: 1_234_567n,
    transactionHash:
      '0xabc0000000000000000000000000000000000000000000000000000000000def',
    transactionIndex: 3,
    blockHash: '0xblock00000000000000000000000000000000000000000000000000000d',
    logIndex: 7,
    removed: false,
    ...over,
  }) satisfies Log;

describe('planSubscriptionScan — gap-cap math', () => {
  it('baselines a fresh (null-cursor) subscription at the head without scanning', () => {
    expect(planSubscriptionScan(null, 1_000n)).toEqual({ action: 'baseline', head: 1_000n });
  });

  it('does nothing when the cursor already covers the head', () => {
    expect(planSubscriptionScan(1_000n, 1_000n)).toEqual({ action: 'none' });
  });

  it('baselines (follows the new branch) when a reorg shrank the head', () => {
    expect(planSubscriptionScan(1_000n, 998n)).toEqual({ action: 'baseline', head: 998n });
  });

  it('scans the full missed range when the gap is below the cap', () => {
    expect(planSubscriptionScan(900n, 1_000n)).toEqual({
      action: 'scan',
      from: 901n,
      to: 1_000n,
      skippedFrom: null,
      skippedTo: null,
    });
  });

  it('scans the full range at exactly the cap boundary (200)', () => {
    expect(planSubscriptionScan(800n, 1_000n)).toEqual({
      action: 'scan',
      from: 801n,
      to: 1_000n,
      skippedFrom: null,
      skippedTo: null,
    });
  });

  it('scans only the newest cap blocks and reports the skipped range one block over', () => {
    // gap 201: one block beyond the cap is honestly skipped.
    expect(planSubscriptionScan(799n, 1_000n)).toEqual({
      action: 'scan',
      from: 801n,
      to: 1_000n,
      skippedFrom: 800n,
      skippedTo: 800n,
    });
  });

  it('caps a huge gap at the newest cap blocks', () => {
    // 10,000-block outage: scan 9,801..10,000, skip 501..9,800.
    expect(planSubscriptionScan(500n, 10_000n)).toEqual({
      action: 'scan',
      from: 10_000n - BigInt(WATCH_GAP_BLOCK_CAP) + 1n,
      to: 10_000n,
      skippedFrom: 501n,
      skippedTo: 9_800n,
    });
  });

  it('honors an explicit smaller cap (the planner is parameterized)', () => {
    expect(planSubscriptionScan(100n, 105n, 4)).toEqual({
      action: 'scan',
      from: 102n,
      to: 105n,
      skippedFrom: 101n,
      skippedTo: 101n,
    });
  });
});

describe('shapeLogEvent — event shaping', () => {
  it('shapes a log with decimal strings for bigints and lowercased address', () => {
    const at = new Date('2026-09-23T10:00:00.000Z');
    const event = shapeLogEvent(1, ADDRESS.toUpperCase(), logFixture(), at);
    expect(event).toEqual({
      kind: 'log',
      chainId: 1,
      address: ADDRESS,
      blockNumber: '1234567',
      txHash: '0xabc0000000000000000000000000000000000000000000000000000000000def',
      logIndex: 7,
      topic0:
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      message: null,
      at: '2026-09-23T10:00:00.000Z',
    });
  });

  it('degrades missing ids to null instead of fabricating values', () => {
    const event = shapeLogEvent(
      137,
      ADDRESS,
      logFixture({ blockNumber: null, transactionHash: null, logIndex: null, topics: [] }),
    );
    expect(event.blockNumber).toBe('0');
    expect(event.txHash).toBeNull();
    expect(event.logIndex).toBeNull();
    expect(event.topic0).toBeNull();
  });
});

describe('gapMarkerEvent — honest unchecked-range marker', () => {
  it('carries the skipped bounds in its message and tops out at the range end', () => {
    const event = gapMarkerEvent(1, ADDRESS, 501n, 9_800n, new Date(0));
    expect(event.kind).toBe('gap');
    expect(event.blockNumber).toBe('9800');
    expect(event.message).toBe('monitoring lagged; blocks 501–9800 unchecked');
    expect(event.txHash).toBeNull();
    expect(event.address).toBe(ADDRESS);
  });
});

describe('WatchEventRing — ring buffer semantics', () => {
  it('returns events newest-first', () => {
    const ring = new WatchEventRing(3);
    const e1 = gapMarkerEvent(1, ADDRESS, 1n, 1n);
    const e2 = gapMarkerEvent(1, ADDRESS, 2n, 2n);
    ring.push(e1);
    ring.push(e2);
    expect(ring.newestFirst(10)).toEqual([e2, e1]);
  });

  it('evicts from the tail at capacity', () => {
    const ring = new WatchEventRing(2);
    const events = [1n, 2n, 3n].map(n => gapMarkerEvent(1, ADDRESS, n, n));
    for (const event of events) ring.push(event);
    expect(ring.size).toBe(2);
    // The newest two survive; the oldest fell off.
    expect(ring.newestFirst(10)).toEqual([events[2], events[1]]);
  });

  it('newestFirst returns a copy bounded by the limit', () => {
    const ring = new WatchEventRing(WATCH_RING_CAPACITY);
    const events = [1n, 2n, 3n].map(n => gapMarkerEvent(1, ADDRESS, n, n));
    for (const event of events) ring.push(event);
    const slice = ring.newestFirst(2);
    expect(slice).toEqual([events[2], events[1]]);
    slice.pop();
    expect(ring.size).toBe(3);
  });
});

describe('toSubscriptionView — subscription row shaping', () => {
  it('stringifies the bigint cursor and ISO-formats dates, keeping nulls', () => {
    const view = toSubscriptionView({
      chainId: 1,
      address: ADDRESS.toUpperCase(),
      label: 'Cold wallet',
      lastProcessedBlock: 19_000_000n,
      createdAt: new Date('2026-09-23T09:00:00.000Z'),
      updatedAt: new Date('2026-09-23T09:30:00.000Z'),
    });
    expect(view).toEqual({
      chainId: 1,
      address: ADDRESS,
      label: 'Cold wallet',
      lastProcessedBlock: '19000000',
      createdAt: '2026-09-23T09:00:00.000Z',
      updatedAt: '2026-09-23T09:30:00.000Z',
    });
  });

  it('keeps a non-baselined cursor honest (null) and tolerates null timestamps', () => {
    const view = toSubscriptionView({
      chainId: 137,
      address: ADDRESS,
      label: null,
      lastProcessedBlock: null,
      createdAt: null,
      updatedAt: null,
    });
    expect(view.lastProcessedBlock).toBeNull();
    expect(view.createdAt).toBeNull();
    expect(view.label).toBeNull();
  });
});
