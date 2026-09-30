/**
 * Focused component tests: EventTable's fetch lifecycle —
 *  - out-of-order responses are discarded (request id guard),
 *  - mount with initialEvents issues exactly one fetch,
 *  - a raw-log disclosure toggle re-renders only the affected row
 *    (memoized EventRow).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, createRoutes } from '@native-router/react';
import type { ReactNode } from 'react';
import '@testing-library/jest-dom/vitest';

import EventTable, { EventRow, type EventRowProps } from '@/components/events/EventTable';
import { get } from '@/util/http';

vi.mock('@/util/http', () => ({
  get: vi.fn(),
}));

const ADDRESS = '0x1234567890123456789012345678901234567890';

type FixtureRow = {
  blockNumber: number;
  blockTimestamp: string;
  transactionHash: `0x${string}`;
  eventName: string;
  isFinalized: boolean;
  logIndex: number;
  // Raw log fields so the disclosure renders its full body (without them
  // it degrades to the honest "not stored" note, which carries no testid).
  topic0: string;
  data: string;
};

const row = (blockNumber: number, eventName: string): FixtureRow => ({
  blockNumber,
  blockTimestamp: new Date(Date.UTC(2026, 0, blockNumber + 1)).toISOString(),
  transactionHash: `0x${blockNumber.toString(16).padStart(2, '0').repeat(32)}`,
  eventName,
  isFinalized: true,
  logIndex: 0,
  topic0: `0x${'dd'.repeat(32)}`,
  data: `0x${'ab'.repeat(32)}`,
});

const page = (events: FixtureRow[]) => ({
  events,
  total: events.length,
  page: 1,
  totalPages: 1,
});

// TypedLink needs router context (useRouter throws bare); the stub routes
// keep every disclosure link target resolvable (raw-log test pattern).
const RouteStub = () => <span data-testid="route-stub" />;
const stubRoutes = createRoutes([
  { path: '/chain/:chainId/tx/:txHash', component: () => RouteStub },
  { path: '/signatures', component: () => RouteStub },
]);

const renderTable = (initialEvents?: FixtureRow[]) =>
  render(
    <MemoryRouter routes={stubRoutes}>
      <EventTable
        chainId={1}
        contractAddress={ADDRESS as `0x${string}`}
        initialEvents={initialEvents}
      />
    </MemoryRouter>,
  );

// Deferred used to hold a fetch response back until the test releases it.
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

// A macrotask boundary inside act: flushes every pending microtask so
// in-flight fetch continuations have provably run before asserting.
const flush = () => act(async () => Promise.resolve(new Promise(r => setTimeout(r, 0))));

describe('EventTable fetch lifecycle', () => {
  beforeEach(() => {
    vi.mocked(get).mockReset();
  });

  it('discards a slow earlier response that resolves after a newer one', async () => {
    const stale = page([row(1111, 'Stale')]);
    const staleDeferred = createDeferred<typeof stale>();
    vi.mocked(get)
      .mockResolvedValueOnce(page([row(100, 'Mounted')])) // initial mount fetch
      .mockImplementationOnce(() => staleDeferred.promise) // sort change #1 — slow
      .mockResolvedValueOnce(page([row(4242, 'Fresh')])); // sort change #2 — fast

    renderTable();
    expect(await screen.findByText('Mounted')).toBeInTheDocument();

    // Two sort changes in quick succession: the first request (slow) is
    // superseded by the second (fast) while both are still in flight.
    fireEvent.click(screen.getByRole('columnheader', { name: /Block/ }));
    fireEvent.click(screen.getByRole('columnheader', { name: /Time/ }));

    // The fast (newer) response is applied.
    expect(await screen.findByText('Fresh')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(3);

    // The slow (older) response resolves last — it must be discarded,
    // leaving the rows of the newer request in place.
    staleDeferred.resolve(stale);
    await flush();

    expect(screen.getByText('Fresh')).toBeInTheDocument();
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
  });

  it('fetches exactly once on mount when initialEvents pre-populate the table', async () => {
    vi.mocked(get).mockResolvedValue(page([row(200, 'Server')]));

    renderTable([row(100, 'Initial')]);

    expect(await screen.findByText('Server')).toBeInTheDocument();
    // Settle every effect that could still issue a duplicate mount fetch.
    await flush();

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('re-renders only the toggled row on a raw-log disclosure toggle', async () => {
    vi.mocked(get).mockResolvedValue(
      page([row(1, 'One'), row(2, 'Two'), row(3, 'Three')]),
    );

    // React.memo stores the inner render function on `.type` (writable
    // descriptor): routing it through a spy counts actual row renders.
    const rowType = EventRow as unknown as { type: (props: EventRowProps) => ReactNode };
    const originalType = rowType.type;
    const renderSpy = vi.spyOn(rowType, 'type').mockImplementation(props => originalType(props));

    try {
      renderTable();
      expect(await screen.findByText('Three')).toBeInTheDocument();
      // One render per row to mount; subsequent parent renders are skipped
      // by memo because no row prop changed.
      expect(renderSpy).toHaveBeenCalledTimes(3);

      await userEvent.click(screen.getByRole('button', { name: /Raw log for block 1/ }));
      await waitFor(() =>
        expect(screen.getByTestId('raw-log-disclosure')).toBeInTheDocument(),
      );

      // Only the toggled row re-rendered; its siblings were skipped by memo.
      expect(renderSpy).toHaveBeenCalledTimes(4);
    } finally {
      renderSpy.mockRestore();
    }
  });
});
