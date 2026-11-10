// Poll generation guards — the three layers that keep stale fetch results
// off the DOM while the indexing panels poll:
//
// 1. util/useGenerationGuard — the claim-based guard behind every
//    hand-rolled fetch left in the panels (EventStatistics' status half,
//    IndexingRangeManager's chain-head fetch, EventTable's event pages).
//    Every run CLAIMS a fresh id; a read-based guard once let two
//    overlapping ticks share one id (both passed isCurrent, the staler
//    settle won), so the shared API exposes claim/isCurrent/invalidate and
//    deliberately nothing else.
// 2. The query layer's native newest-run-wins — the ranges half of BOTH
//    panels rides services/eventsRanges.ts; react-toolroom claims a
//    monotonic sequence per chain run and discards any settle older than
//    an already-applied claim. Pinned here by overlapping a shared poll
//    tick with a refetch (which deletes the in-flight entry first, so the
//    two requests genuinely overlap) and settling the NEWER one first.
// 3. The single-interval coordinator in services/eventsRanges.ts — both
//    panels mounted share ONE ranges request per tick, a tick whose
//    fan-out has not settled is never piled onto, and the interval dies
//    with its last member.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, screen, fireEvent } from '@testing-library/react';
import EventStatistics from '@/components/events/EventStatistics';
import IndexingRangeManager from '@/components/events/IndexingRangeManager';
import { useGenerationGuard } from '@/util/useGenerationGuard';
import { clearAllCaches } from '@/util/useQuery';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));

vi.mock('@/util/http', () => ({
  get: mockGet,
  post: mockPost,
  del: vi.fn(),
}));

const CHAIN_ID = 1;
const ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const rangesUrl = `/api/chains/${CHAIN_ID}/contracts/${ADDRESS}/events/ranges`;
const statusUrl = `/api/chains/${CHAIN_ID}/contracts/${ADDRESS}/events/indexing-status`;

type Pending = { url: string; resolve: (value: unknown) => void };

// Every `get` parks in an unresolved promise until the test settles it, so
// the test — not the component — decides which request lands first.
let pending: Pending[] = [];

const settle = async (
  url: string,
  value: unknown,
  which: 'oldest' | 'newest',
): Promise<void> => {
  const matches = pending
    .map((entry, index) => ({ entry, index }))
    .filter(candidate => candidate.entry.url === url);
  if (matches.length === 0) throw new Error(`no pending request for ${url}`);
  const chosen = which === 'oldest' ? matches[0] : matches[matches.length - 1];
  const entry = pending.splice(chosen.index, 1)[0];
  await act(async () => {
    entry.resolve(value);
  });
};

const rangeFixture = (
  rangeId: number,
  from: number,
  to: number,
  currentBlock: number | null,
  status: 'indexing' | 'paused' = 'indexing',
) => ({
  chainId: CHAIN_ID,
  address: ADDRESS,
  rangeId,
  fromBlock: BigInt(from),
  toBlock: BigInt(to),
  direction: 'forward' as const,
  currentBlock: currentBlock === null ? null : BigInt(currentBlock),
  status,
  totalEventsIndexed: 0,
  errorMessage: null,
  priority: 0,
  createdAt: null,
  updatedAt: null,
});

const indexingStatus = (totalEventsIndexed: number) => ({
  chainId: CHAIN_ID,
  address: ADDRESS,
  status: 'indexing' as const,
  totalEventsIndexed,
  totalBlocks: 0,
  lastProcessedBlock: 0,
  createdAt: null,
  updatedAt: null,
  errorMessage: null,
  eventTypes: [],
  rangesCompleted: 0,
  rangesIndexing: 1,
  rangesPending: 0,
  rangesPaused: 0,
  rangesError: 0,
});

beforeEach(() => {
  pending = [];
  // The shared ranges cache outlives a component tree; every test starts
  // cold or the previous test's payload would stale-serve into this one.
  clearAllCaches();
  mockGet.mockReset().mockImplementation(
    (url: string) =>
      new Promise(resolve => {
        pending.push({ url, resolve });
      }),
  );
  mockPost.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useGenerationGuard (shared claim-based guard)', () => {
  it('only the newest claim is current', () => {
    const { result } = renderHook(() => useGenerationGuard());
    const first = result.current.claim();
    const second = result.current.claim();
    expect(result.current.isCurrent(first)).toBe(false);
    expect(result.current.isCurrent(second)).toBe(true);
  });

  it('invalidate kills every outstanding claim at once', () => {
    const { result } = renderHook(() => useGenerationGuard());
    const id = result.current.claim();
    act(() => {
      result.current.invalidate();
    });
    expect(result.current.isCurrent(id)).toBe(false);
  });

  it('unmount invalidates in-flight runs', () => {
    const { result, unmount } = renderHook(() => useGenerationGuard());
    const id = result.current.claim();
    unmount();
    expect(result.current.isCurrent(id)).toBe(false);
  });
});

describe('EventStatistics status guard (hand-rolled half)', () => {
  it('a superseded status tick cannot overwrite the newest tick', async () => {
    vi.useFakeTimers();
    render(<EventStatistics chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    // Mount settles so the 3s status loop arms on 'indexing'.
    await settle(statusUrl, indexingStatus(1_000), 'oldest');
    await settle(rangesUrl, { ranges: [rangeFixture(1, 10, 20, 15)] }, 'oldest');
    expect(screen.getByText('1,000')).toBeInTheDocument();

    // Two status ticks fire (the hand-rolled loop has no overlap guard).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    // The NEWER tick answers first…
    await settle(statusUrl, indexingStatus(9_000), 'newest');
    await settle(rangesUrl, { ranges: [rangeFixture(1, 100, 200, 150)] }, 'newest');
    // …then the STALE tick lands with its old snapshot.
    await settle(statusUrl, indexingStatus(2_222), 'oldest');

    expect(screen.queryByText('2,222')).toBeNull();
    expect(screen.getByText('9,000')).toBeInTheDocument();
  });
});

describe('EventStatistics ranges guard (query layer)', () => {
  it('a shared tick settling after a manual refetch cannot repaint the older snapshot', async () => {
    vi.useFakeTimers();
    render(<EventStatistics chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    await settle(statusUrl, indexingStatus(1_000), 'oldest');
    await settle(rangesUrl, { ranges: [rangeFixture(1, 10, 20, 15)] }, 'oldest');
    // Coverage math is inclusive (15-10+1 of 20-10+1 = 6/11), pinned by
    // the coverage suite.
    expect(screen.getByText(/6\s*\/\s*11/)).toBeInTheDocument();

    // A shared tick fires and stalls…
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    // The status half's own 3s tick parked at the same cadence and holds
    // the busy flag (loading disables Refresh) — settle it so the button
    // is clickable before exercising the ranges overlap.
    await settle(statusUrl, indexingStatus(1_000), 'oldest');
    // …and the user hits refresh: the refetch DELETES the in-flight tick
    // entry first (useRefresh semantics) and issues a genuinely new
    // request, so the two now overlap.
    fireEvent.click(screen.getByTitle('Refresh'));
    await act(async () => {});

    // The refetch (newer claim) answers first with a fully covered span…
    await settle(rangesUrl, { ranges: [rangeFixture(1, 10, 20, 20)] }, 'newest');
    // …then the stale tick lands with its half-covered snapshot.
    await settle(rangesUrl, { ranges: [rangeFixture(1, 10, 20, 12)] }, 'oldest');

    expect(screen.getByText(/11\s*\/\s*11/)).toBeInTheDocument();
    expect(screen.queryByText(/3\s*\/\s*11/)).toBeNull();
  });
});

describe('IndexingRangeManager ranges guard (query layer)', () => {
  it('a shared tick settling after a mutation refetch cannot repaint the older snapshot', async () => {
    vi.useFakeTimers();
    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);
    // Flush the query layer's microtask-deferred mount run before the
    // first settle (the harness pattern every IRM-first test needs).
    await act(async () => {});

    // Tick A (mount) resolves so the shared 3s poll arms on an indexing range.
    await settle(rangesUrl, { ranges: [rangeFixture(1, 10, 20, 15)] }, 'oldest');
    await settle(statusUrl, { latestBlock: 20 }, 'oldest');
    expect(screen.getByText('#10 - 20')).toBeInTheDocument();

    // A shared tick fires and stalls…
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    // …and the Pause mutation completes: its refetch deletes the in-flight
    // tick entry and issues a genuinely new request.
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await act(async () => {});

    // The refetch (newer claim) answers first: the range is paused…
    await settle(rangesUrl, { ranges: [rangeFixture(1, 10, 20, 15, 'paused')] }, 'newest');
    // …the fresh payload legitimately refreshes the chain head…
    await settle(statusUrl, { latestBlock: 20 }, 'newest');
    // …then the STALE tick lands with an old snapshot from another span.
    await settle(rangesUrl, { ranges: [rangeFixture(1, 300, 400, 350)] }, 'oldest');

    // The stale run must be discarded at the store gate: its snapshot
    // never reaches the DOM, the paused range stays paused, and no head
    // fetch runs for it either.
    expect(screen.queryByText('#300 - 400')).toBeNull();
    expect(screen.getByText('#10 - 20')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(pending.filter(entry => entry.url === statusUrl)).toHaveLength(0);
  });
});

describe('eventsRanges single-flight (both panels on one poll)', () => {
  it('both panels mounted share ONE ranges request — at mount and per tick', async () => {
    vi.useFakeTimers();
    render(<EventStatistics chainId={CHAIN_ID} contractAddress={ADDRESS} />);
    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);
    // The query layer's mount run parks off a microtask (ES' hand-rolled
    // status fetch parks synchronously; useRun's initial load does not) —
    // flush once so the mount-join assertion sees the parked request.
    await act(async () => {});

    // The second panel's mount JOINED the first's in-flight ranges request
    // (provider single-flight) instead of issuing a second one.
    expect(pending.filter(entry => entry.url === rangesUrl)).toHaveLength(1);

    // Feed both panels from that one request (plus ES' status and IRM's
    // head for the fresh payload — different endpoints, one each).
    await settle(rangesUrl, { ranges: [rangeFixture(1, 10, 20, 15)] }, 'oldest');
    await settle(statusUrl, indexingStatus(1_000), 'oldest');
    await settle(statusUrl, { latestBlock: 20 }, 'oldest');
    expect(screen.getByText('#10 - 20')).toBeInTheDocument();
    expect(screen.getByText('1,000')).toBeInTheDocument();

    // Now let responses resolve instantly and watch a full tick: ONE
    // ranges GET serves both panels (the old double poll issued two).
    mockGet.mockImplementation(async (url: string) => {
      if (url === rangesUrl) return { ranges: [rangeFixture(1, 10, 20, 16)] };
      // Full IndexingStatus shape: ES' status tick consumes it directly,
      // IRM's head fetch reads only latestBlock (absent → 0, banner hidden).
      return indexingStatus(1_000);
    });
    mockGet.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    const callsTo = (url: string) => mockGet.mock.calls.filter(([u]) => u === url).length;
    expect(callsTo(rangesUrl)).toBe(1);
    // ES' status tick + IRM's head refresh for the fresh payload.
    expect(callsTo(statusUrl)).toBe(2);
  });

  it('a tick whose request has not settled is never piled onto', async () => {
    vi.useFakeTimers();
    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);
    // Flush the microtask-deferred mount run before the first settle.
    await act(async () => {});

    await settle(rangesUrl, { ranges: [rangeFixture(1, 10, 20, 15)] }, 'oldest');
    await settle(statusUrl, { latestBlock: 20 }, 'oldest');

    // Three elapsed cadences…
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    // …but only ONE ranges request outstanding: the coordinator skips
    // ticks while the previous fan-out is unresolved (usePolling parity).
    expect(pending.filter(entry => entry.url === rangesUrl)).toHaveLength(1);
  });

  it('the shared interval dies with its last member', async () => {
    vi.useFakeTimers();
    const { unmount: unmountStatistics } = render(
      <EventStatistics chainId={CHAIN_ID} contractAddress={ADDRESS} />,
    );
    const { unmount: unmountRanges } = render(
      <IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />,
    );
    // Flush the microtask-deferred mount run before the first settle.
    await act(async () => {});

    await settle(rangesUrl, { ranges: [rangeFixture(1, 10, 20, 15)] }, 'oldest');
    await settle(statusUrl, indexingStatus(1_000), 'oldest');
    await settle(statusUrl, { latestBlock: 20 }, 'oldest');

    unmountStatistics();
    unmountRanges();
    mockGet.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    // No member, no interval: nothing fires.
    expect(mockGet).not.toHaveBeenCalled();
  });
});
