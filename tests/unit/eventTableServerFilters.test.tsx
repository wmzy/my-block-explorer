/**
 * Focused component tests: EventTable sends ABI arg filters to the server
 * (argFilters query param) instead of filtering the loaded page client-side,
 * and the Export CSV link appears only when the server reports results.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { AbiEvent } from 'viem';
import EventTable from '@/components/events/EventTable';
import { get } from '@/util/http';
import { setApiBase } from '@/util/apiBase';

vi.mock('@/util/http', () => ({
  get: vi.fn(),
}));

// The export href and the degraded-mode disable both key off the runtime
// API base; pin a connected one so the link renders with a full URL.
const EXPORT_BASE = 'http://unit.test:1';

const transferEvent = {
  type: 'event',
  name: 'Transfer',
  inputs: [{ name: 'owner', type: 'address', indexed: true }],
} as unknown as AbiEvent;

const ADDRESS = '0x1234567890123456789012345678901234567890';

const mockGet = (total: number) => {
  vi.mocked(get).mockResolvedValue({
    // A zero total means an empty result set — the fixture mirrors that so
    // the empty state is stable, not just a first-paint transient.
    events:
      total === 0
        ? []
        : [
            {
              blockNumber: 1,
              blockTimestamp: 1700000000,
              transactionHash: '0xabc',
              eventName: 'Transfer',
              decodedArgs: '{"owner":"0xabc"}',
            },
          ],
    total,
    page: 1,
    totalPages: 1,
  });
};

const renderTable = () =>
  render(
    <EventTable
      chainId={1}
      contractAddress={ADDRESS as `0x${string}`}
      abiEvents={[transferEvent]}
      enableDynamicFiltering
    />,
  );

describe('EventTable server-side filtering and export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setApiBase(EXPORT_BASE);
  });

  it('shows the Export CSV link only when the server reports results', async () => {
    mockGet(3);
    renderTable();

    const link = await screen.findByRole('link', { name: 'Export CSV' });
    expect(link.getAttribute('href')).toBe(
      `${EXPORT_BASE}/api/chains/1/contracts/${ADDRESS}/events/export`,
    );
    expect(link).toHaveAttribute('download');
  });

  it('hides the Export CSV link when there are no results', async () => {
    mockGet(0);
    renderTable();

    // No filters applied: the empty state says nothing is indexed yet,
    // not that filters excluded everything.
    await waitFor(() => {
      expect(screen.getByText('No events found')).toBeInTheDocument();
    });
    expect(screen.getByText('No events indexed in this range yet.')).toBeInTheDocument();
    expect(screen.queryByText('No events match the current filters.')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Export CSV' })).toBeNull();
  });

  it('distinguishes a filtered empty state from a not-indexed one', async () => {
    mockGet(0);
    renderTable();
    await screen.findByText('No events indexed in this range yet.');

    fireEvent.change(screen.getByLabelText('Event Type'), { target: { value: 'Transfer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(screen.getByText('No events match the current filters.')).toBeInTheDocument();
    });
    expect(screen.queryByText('No events indexed in this range yet.')).toBeNull();
  });

  it('disables export with an inline notice when the filtered total exceeds the cap', async () => {
    mockGet(150_000);
    renderTable();

    // Rendered as a disabled control: no href means nothing to navigate to,
    // and the notice names the actual query total plus a path forward.
    const control = await screen.findByText('Export CSV');
    expect(control).not.toHaveAttribute('href');
    expect(control).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByText(
        'Too many rows (150,000) — narrow the block range or filters and export in chunks (limit 100,000 rows).',
      ),
    ).toBeInTheDocument();
  });

  it('keeps export enabled at exactly the 100,000-row cap', async () => {
    mockGet(100_000);
    renderTable();

    const link = await screen.findByRole('link', { name: 'Export CSV' });
    expect(link.getAttribute('href')).toBe(
      `${EXPORT_BASE}/api/chains/1/contracts/${ADDRESS}/events/export`,
    );
    expect(screen.queryByText(/Too many rows/)).toBeNull();
  });

  it('sends applied ABI arg filters to the server and into the export URL', async () => {
    mockGet(3);
    renderTable();
    await screen.findByRole('link', { name: 'Export CSV' });

    fireEvent.change(screen.getByLabelText('Event Type'), { target: { value: 'Transfer' } });
    const ownerInput = await screen.findByLabelText(/owner/);
    fireEvent.change(ownerInput, { target: { value: '0xabc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      const url = vi.mocked(get).mock.calls.at(-1)?.[0] ?? '';
      expect(url).toContain(
        `argFilters=${encodeURIComponent('{"owner":"0xabc"}')}`,
      );
    });

    // The export link carries the same filters; the browser filename comes
    // from the backend Content-Disposition header.
    const link = screen.getByRole('link', { name: 'Export CSV' });
    expect(link.getAttribute('href')).toBe(
      `${EXPORT_BASE}/api/chains/1/contracts/${ADDRESS}/events/export?eventName=Transfer&argFilters=${encodeURIComponent('{"owner":"0xabc"}')}`,
    );
  });

  it('hints that filtering runs on the full indexed set', async () => {
    mockGet(1);
    renderTable();

    expect(
      await screen.findByText('Filtering runs on the full indexed set'),
    ).toBeInTheDocument();
  });

  it('shows an unfinalized badge only on rows the chain has not finalized', async () => {
    vi.mocked(get).mockResolvedValue({
      events: [
        {
          blockNumber: 1,
          blockTimestamp: 1700000000,
          transactionHash: '0xabc',
          eventName: 'Transfer',
          decodedArgs: '{"owner":"0xabc"}',
          isFinalized: false,
        },
        {
          blockNumber: 2,
          blockTimestamp: 1700000001,
          transactionHash: '0xabd',
          eventName: 'Transfer',
          decodedArgs: '{"owner":"0xabc"}',
          isFinalized: true,
        },
      ],
      total: 2,
      page: 1,
      totalPages: 1,
    });
    renderTable();

    // Exactly one badge: on the unfinalized row, not the finalized one.
    const badges = await screen.findAllByText('unfinalized');
    expect(badges).toHaveLength(1);
  });
});
