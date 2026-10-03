// EventTable paginated a TRUNCATED server page in the client-side-sort
// branch.
//
// Two numbers that must agree did not:
//
//   shouldUseClientSideSort = total > 0 && total <= clientSideSortThreshold
//                             (the SERVER-reported count, default 1000)
//   fetchEvents asks for    pageSize = pagination.limit (default 50)
//
// So any contract with `limit < total <= 1000` took the client-side
// branch — which paginates and sorts `allEvents` locally and never
// re-fetches on Next — while `allEvents` held only the first `limit`
// server rows. A contract with 60 events: page 1 shows 50 rows, the
// footer says "Page 1 / 2" from the server total, and Next only bumps
// the page number, so `paginateData` slices rows 50..60 out of a 50-row
// array. Page 2 rendered the EMPTY state, unreachable by any means, with
// a Next button still enabled and the same UI displaying a count of 60.
//
// The threshold is the honest knob and the request must respect it: the
// client-side branch may only paginate what it actually holds, so either
// the whole set is fetched (pageSize = total) or the branch is off.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import EventTable from '@/components/events/EventTable';
import { get } from '@/util/http';
import { setApiBase } from '@/util/apiBase';

vi.mock('@/util/http', () => ({
  get: vi.fn(),
}));

const ADDRESS = '0x1234567890123456789012345678901234567890';
const TOTAL = 60; // > the 50-row page size, <= the 1000 sort threshold

const serverEvent = (i: number) => ({
  blockNumber: 1_000_000 + i,
  blockTimestamp: 1_700_000_000 + i,
  transactionHash: `0x${String(i).padStart(64, '0')}`,
  logIndex: i,
  eventName: 'Transfer',
  decodedArgs: `{"seq":${i}}`,
});

/** Serves `pageSize` rows per page, exactly as the real route does. */
const mockPagedServer = (total: number) => {
  vi.mocked(get).mockImplementation(async (url: string) => {
    const params = new URLSearchParams(url.split('?')[1] ?? '');
    const page = Number(params.get('page') ?? '1');
    const pageSize = Number(params.get('pageSize') ?? '50');
    const start = (page - 1) * pageSize;
    const events = Array.from(
      { length: Math.max(0, Math.min(pageSize, total - start)) },
      (_, i) => serverEvent(start + i),
    );
    return {
      events,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  });
};

const renderTable = () =>
  render(<EventTable chainId={1} contractAddress={ADDRESS} />);

const rowCount = (): number => document.querySelectorAll('tbody tr').length;
const nextButton = (): HTMLElement =>
  Array.from(document.querySelectorAll('button')).find(b => b.title === 'Next page')!;

describe('EventTable pagination over a multi-page server result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setApiBase('http://unit.test:1');
  });

  it('reaches the last page of a 60-event set instead of showing an empty one', async () => {
    mockPagedServer(TOTAL);
    renderTable();

    await waitFor(() => expect(screen.getByText(/Page 1 \/ 2/)).toBeDefined());
    expect(rowCount()).toBe(50);

    fireEvent.click(nextButton());

    // Page 2 must render the remaining 10 rows. The pre-fix code
    // paginated a 50-row array and rendered the empty state here.
    await waitFor(() => {
      expect(screen.getByText(/Page 2 \/ 2/)).toBeDefined();
      expect(rowCount()).toBe(10);
    });
  });

  it('asks the server for the whole set when it will paginate it locally', async () => {
    mockPagedServer(TOTAL);
    renderTable();
    await waitFor(() => expect(screen.getByText(/Page 1 \/ 2/)).toBeDefined());

    // The client-side branch can only paginate what it holds. The FIRST
    // request cannot know the total yet, so it is legitimately one page
    // wide; the contract is that a request covering the whole set is
    // issued once the response reveals it. Assert the widened request
    // exists rather than that the first one was already wide.
    const requested = vi.mocked(get).mock.calls.map(([url]) => url);
    const pageSizes = requested.map(
      u => Number(new URLSearchParams(u.split('?')[1] ?? '').get('pageSize')),
    );
    expect(pageSizes.some(size => size >= TOTAL)).toBe(true);
    // And exactly one widening — it must not loop.
    expect(pageSizes.filter(size => size >= TOTAL)).toHaveLength(1);
  });

  it('keeps every row reachable across both pages without duplicates', async () => {
    mockPagedServer(TOTAL);
    renderTable();
    await waitFor(() => expect(rowCount()).toBe(50));

    // Identify rows by the block number the fixture assigns, which is
    // rendered in the row itself — no reliance on the decoded-args
    // serialization shape.
    const blocks = () =>
      Array.from(document.querySelectorAll('tbody tr')).map(
        r => r.textContent?.match(/1,?0{3}[,\d]*/)?.[0]?.replace(/[^\d]/g, '') ?? '',
      );

    const firstPage = blocks();

    fireEvent.click(nextButton());
    await waitFor(() => expect(rowCount()).toBe(10));

    const all = [...firstPage, ...blocks()];
    expect(all).toHaveLength(TOTAL);
    // No duplicate block across the two pages, and no gaps in the series.
    expect(new Set(all).size).toBe(TOTAL);
    const asNumbers = all.map(Number).sort((a, b) => a - b);
    expect(asNumbers).toEqual(
      Array.from({ length: TOTAL }, (_, i) => 1_000_000 + i),
    );
  });
});
