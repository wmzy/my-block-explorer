// Poll generation guards: both indexing panels poll every 3s and both
// carry a `requestIdRef` "generation guard" whose stated job (see their own
// comments) is "only the newest run writes" — a superseded poll tick must
// not replace fresher data, and a stale run must not clear the spinner its
// successor set. The guard only ever advanced on an identity change
// (contract switch) / unmount, while each run captured the CURRENT id
// (`const requestId = ref.current`) instead of claiming a new one: two
// overlapping ticks of the SAME component read the SAME id, both passed
// `isCurrent()`, and whichever settled LAST won. Ticks overlap whenever a
// response is slower than the 3s cadence (an ordinary condition on a public
// RPC), so a stale tick could paint old ranges/status over fresh ones.
//
// These tests drive two overlapping ticks with manually controlled
// promises and settle the NEWER one first; the stale response must never
// reach the DOM.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import EventStatistics from '@/components/events/EventStatistics';
import IndexingRangeManager from '@/components/events/IndexingRangeManager';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('@/util/http', () => ({
  get: mockGet,
  post: vi.fn(),
  del: vi.fn(),
}));

const CHAIN_ID = 1;
const ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const rangesUrl = `/api/chains/${CHAIN_ID}/contracts/${ADDRESS}/events/ranges`;
const statusUrl = `/api/chains/${CHAIN_ID}/contracts/${ADDRESS}/events/indexing-status`;

type Pending = { url: string; resolve: (value: unknown) => void };

// Every `get` parks in an unresolved promise until the test settles it, so
// the test — not the component — decides which tick lands first.
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

const rangeFixture = (rangeId: number, from: number, to: number, currentBlock: number | null) => ({
  chainId: CHAIN_ID,
  address: ADDRESS,
  rangeId,
  fromBlock: BigInt(from),
  toBlock: BigInt(to),
  direction: 'forward' as const,
  currentBlock: currentBlock === null ? null : BigInt(currentBlock),
  status: 'indexing' as const,
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
  mockGet.mockReset().mockImplementation(
    (url: string) =>
      new Promise(resolve => {
        pending.push({ url, resolve });
      }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('IndexingRangeManager poll generation guard', () => {
  it('a superseded poll tick cannot overwrite the newest tick’s ranges', async () => {
    vi.useFakeTimers();
    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    // Tick A (mount) resolves so the 3s poll arms on an indexing range.
    await settle(rangesUrl, { ranges: [rangeFixture(1, 10, 20, 15)] }, 'oldest');
    await settle(statusUrl, { latestBlock: 20 }, 'oldest');
    expect(screen.getByText('#10 - 20')).toBeInTheDocument();

    // Tick B fires and stalls (a slow RPC); tick C fires on top of it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    // The NEWER tick (C) answers first with the current ranges…
    await settle(rangesUrl, { ranges: [rangeFixture(1, 100, 200, 150)] }, 'newest');
    await settle(statusUrl, { latestBlock: 200 }, 'newest');
    // …then the STALE tick (B) lands with its old snapshot.
    await settle(rangesUrl, { ranges: [rangeFixture(1, 300, 400, 350)] }, 'oldest');

    // The stale run must stop at its own guard: no head fetch, and its
    // old ranges never reach the DOM.
    expect(pending.filter(entry => entry.url === statusUrl)).toHaveLength(0);
    expect(screen.queryByText('#300 - 400')).toBeNull();
    expect(screen.getByText('#100 - 200')).toBeInTheDocument();
  });
});

describe('EventStatistics poll generation guard', () => {
  it('a superseded poll tick cannot overwrite the newest tick’s status', async () => {
    vi.useFakeTimers();
    render(<EventStatistics chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    await settle(statusUrl, indexingStatus(1_000), 'oldest');
    await settle(rangesUrl, { ranges: [rangeFixture(1, 10, 20, 15)] }, 'oldest');
    expect(screen.getByText('1,000')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    // Newer tick (C) first, stale tick (B) after.
    await settle(statusUrl, indexingStatus(9_000), 'newest');
    await settle(rangesUrl, { ranges: [rangeFixture(1, 100, 200, 150)] }, 'newest');
    await settle(statusUrl, indexingStatus(2_222), 'oldest');
    await settle(rangesUrl, { ranges: [rangeFixture(1, 300, 400, 350)] }, 'oldest');

    expect(screen.queryByText('2,222')).toBeNull();
    expect(screen.getByText('9,000')).toBeInTheDocument();
  });
});
