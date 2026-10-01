// The events status bar and the range manager both poll the backend with
// unguarded setState: a fetch started for contract A can settle AFTER a
// fetch started for contract B and overwrite B's data (native-router
// reuses the component instance across a contract switch, so no unmount
// invalidates the in-flight request). The status bar also keeps its
// "events grew" counter across contracts, so B's smaller count compares
// against A's and fires the refresh callback for the wrong contract.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import EventStatistics from '@/components/events/EventStatistics';
import IndexingRangeManager from '@/components/events/IndexingRangeManager';
import { get } from '@/util/http';

vi.mock('@/util/http', () => ({
  get: vi.fn(),
}));

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';

const range = (fromBlock: number, toBlock: number, status: string) => ({
  fromBlock,
  toBlock,
  status,
  direction: 'forward',
  currentBlock: null,
});

// One deferred pair per contract so the A request can be settled AFTER the
// B request has already answered — the exact interleaving a slow backend
// produces on a contract switch.
const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(r => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
});

// The bar's "Events:" figure. The label is a bare text node inside the
// metric row, so locate the ROW (an element whose direct text starts with
// "Events:") and read its value span — the Types row is a sibling.
const eventCount = (): string => {
  const rows = Array.from(document.querySelectorAll('div'));
  const row = rows.find(node => /^Events:/.test((node.textContent ?? '').trim()));
  const value = row?.querySelector('span');
  return (value?.textContent ?? '').trim();
};

afterEach(() => {
  vi.useRealTimers();
});

describe('EventStatistics survives a contract switch mid-flight', () => {
  it('never lets contract A\'s answer paint over contract B\'s', async () => {
    const aCalls = { status: deferred(), ranges: deferred() };
    const bStatus = {
      chainId: 1,
      contractAddress: B,
      status: 'idle',
      creationBlock: 0,
      lastIndexedBlock: 0,
      latestBlock: 0,
      totalEventsIndexed: 7,
      eventTypes: [],
    };
    const bRanges = { ranges: [range(0, 99, 'completed')] };

    vi.mocked(get).mockImplementation((url: string) => {
      if (url.includes(A)) {
        return url.endsWith('/events/ranges')
          ? aCalls.ranges.promise
          : aCalls.status.promise;
      }
      return Promise.resolve(
        url.endsWith('/events/ranges') ? bRanges : bStatus,
      );
    });

    const view = render(<EventStatistics chainId={1} contractAddress={A as `0x${string}`} />);
    // The A pair is now in flight and will be held.
    await act(async () => {});

    // Switch contracts — same component instance, new prop.
    view.rerender(<EventStatistics chainId={1} contractAddress={B} />);
    await act(async () => {});
    expect(screen.getByText(/Indexing coverage/)).toBeInTheDocument();
    expect(eventCount()).toBe('7');

    // Now the stale A request finally answers.
    await act(async () => {
      aCalls.status.resolve({
        chainId: 1,
        contractAddress: A,
        status: 'indexing',
        creationBlock: 0,
        lastIndexedBlock: 0,
        latestBlock: 0,
        totalEventsIndexed: 9999,
        eventTypes: [],
      });
      aCalls.ranges.resolve({ ranges: [range(500, 599, 'completed')] });
    });

    // B's numbers must still be on screen.
    expect(eventCount()).toBe('7');
  });

  it('does not fire the events-updated callback for the previous contract\'s count', async () => {
    const aCalls = { status: deferred(), ranges: deferred() };
    const onEventsUpdated = vi.fn();

    vi.mocked(get).mockImplementation((url: string) => {
      if (url.includes(A)) {
        return url.endsWith('/events/ranges')
          ? aCalls.ranges.promise
          : aCalls.status.promise;
      }
      return Promise.resolve(
        url.endsWith('/events/ranges')
          ? { ranges: [] }
          : {
              chainId: 1,
              contractAddress: B,
              status: 'idle',
              creationBlock: 0,
              lastIndexedBlock: 0,
              latestBlock: 0,
              totalEventsIndexed: 2,
              eventTypes: [],
            },
      );
    });

    const view = render(
      <EventStatistics
        chainId={1}
        contractAddress={A as `0x${string}`}
        onEventsUpdated={onEventsUpdated}
      />,
    );
    await act(async () => {});

    view.rerender(
      <EventStatistics
        chainId={1}
        contractAddress={B}
        onEventsUpdated={onEventsUpdated}
      />,
    );
    await act(async () => {});
    // B's own count (2) legitimately fires the callback — that is this
    // contract's baseline settling. A's late answer must not fire again.
    onEventsUpdated.mockClear();

    await act(async () => {
      aCalls.status.resolve({
        chainId: 1,
        contractAddress: A,
        status: 'idle',
        creationBlock: 0,
        lastIndexedBlock: 0,
        latestBlock: 0,
        totalEventsIndexed: 500,
        eventTypes: [],
      });
      aCalls.ranges.resolve({ ranges: [] });
    });

    // A's 500 must not be compared against the counter left by B.
    expect(onEventsUpdated).not.toHaveBeenCalled();
  });
});

describe('IndexingRangeManager survives a contract switch mid-flight', () => {
  const managerRange = (rangeId: number, from: number, to: number) => ({
    chainId: 1,
    address: B,
    rangeId,
    fromBlock: BigInt(from),
    toBlock: BigInt(to),
    direction: 'forward' as const,
    currentBlock: null,
    status: 'completed' as const,
    totalEventsIndexed: 0,
    errorMessage: null,
    priority: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('keeps the new contract\'s ranges when the old fetch settles late', async () => {
    const aDeferred = deferred();
    vi.mocked(get).mockImplementation((url: string) => {
      if (url.includes(A)) return aDeferred.promise;
      if (url.endsWith('/events/ranges')) {
        return Promise.resolve({ ranges: [managerRange(2, 200, 299)] });
      }
      return Promise.resolve({ latestBlock: 555 });
    });

    const view = render(
      <IndexingRangeManager chainId={1} contractAddress={A as `0x${string}`} />,
    );
    await act(async () => {});

    view.rerender(
      <IndexingRangeManager chainId={1} contractAddress={B} />,
    );
    await act(async () => {});
    expect(await screen.findByText(/#2/)).toBeInTheDocument();

    // The stale A fetch answers now.
    await act(async () => {
      aDeferred.resolve({ ranges: [managerRange(1, 0, 99)] });
    });

    // B's range must still be the one on screen.
    expect(screen.getByText(/#2/)).toBeInTheDocument();
    expect(screen.queryByText(/#1/)).not.toBeInTheDocument();
  });
});
