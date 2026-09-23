// Rendering tests for the Address Overview's SummaryStatsRow strip
// (src/views/Address/index.tsx). The component is exercised with pure
// props — no router — pinning the honesty contract end to end: clean
// absence on an empty discovered set, row-carried timestamps rendered
// without any RPC, and timestamp-less boundaries resolved lazily through
// ONE cached browser-RPC getBlock each (failure → the honest
// "Block N" fallback, never an estimated date).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
// SummaryStatsRow (and the page module it lives in) — vitest hoists the
// vi.mock registrations below above this import.
import {
  SummaryStatsRow,
  resetBlockTimestampCacheForTests,
} from '@/views/Address/index';

const rpcMocks = vi.hoisted(() => ({
  createRpcClient: vi.fn(),
}));

// Only the lazy boundary lookups go through createRpcClient; nothing else
// of the page renders in this file.
vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: rpcMocks.createRpcClient,
}));

const ADDRESS = '0xAbCdEf0123456789012345678901234567890123';
const OTHER = '0x1111111111111111111111111111111111111111';

type Row = Parameters<typeof SummaryStatsRow>[0]['rows'][number];

const row = (overrides: Partial<Row>): Row => ({
  blockNumber: '100',
  fromAddress: OTHER,
  toAddress: ADDRESS,
  value: '0',
  ...overrides,
});

describe('SummaryStatsRow', () => {
  const props = {
    chainId: 1,
    address: ADDRESS,
    symbol: 'ETH',
    decimals: 18,
  };

  beforeEach(() => {
    resetBlockTimestampCacheForTests();
    rpcMocks.createRpcClient.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing for an empty discovered set (clean absence, no zeros)', () => {
    const { container } = render(<SummaryStatsRow {...props} rows={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Total In')).not.toBeInTheDocument();
    expect(rpcMocks.createRpcClient).not.toHaveBeenCalled();
  });

  it('renders totals and row-carried timestamps without any RPC call', () => {
    render(
      <SummaryStatsRow
        {...props}
        rows={[
          row({
            blockNumber: '100',
            fromAddress: ADDRESS,
            toAddress: OTHER,
            value: '1000000000000000000',
            timestamp: '2024-01-01T00:00:00Z',
          }),
          row({
            blockNumber: '200',
            value: '500000000000000000',
            timestamp: '2024-06-01T00:00:00Z',
          }),
        ]}
      />,
    );
    expect(screen.getByText('Total Out').nextElementSibling).toHaveTextContent('1.0000 ETH');
    expect(screen.getByText('Total In').nextElementSibling).toHaveTextContent('0.5000 ETH');
    // Row-carried ISO timestamps render as dates (year presence keeps the
    // assertion locale-agnostic).
    expect(screen.getByText('First Seen').nextElementSibling).toHaveTextContent('2024');
    expect(screen.getByText('Last Seen').nextElementSibling).toHaveTextContent('2024');
    // The discovered-window caveat rides along with the strip; without a
    // discoveredTotal the count IS the full discovered set for the page.
    expect(screen.getByTestId('summary-stats-row')).toHaveTextContent(
      /the 2 discovered transactions of the selected window/,
    );
    expect(rpcMocks.createRpcClient).not.toHaveBeenCalled();
  });

  it('falls back to block numbers while pending, then resolves dates via one cached getBlock per boundary', async () => {
    const getBlock = vi.fn().mockResolvedValue({ timestamp: 1_700_000_000n });
    rpcMocks.createRpcClient.mockResolvedValue({ getBlock });
    const rows = [
      row({ blockNumber: '100', value: '1' }),
      row({ blockNumber: '200', value: '2' }),
    ];
    const { rerender } = render(<SummaryStatsRow {...props} rows={rows} />);
    // No row timestamps: honest block fallback immediately.
    expect(screen.getByText('First Seen').nextElementSibling).toHaveTextContent('Block 100');
    expect(screen.getByText('Last Seen').nextElementSibling).toHaveTextContent('Block 200');
    // Resolves to dates (Nov 2023 UTC — the year survives any timezone).
    await waitFor(() => {
      expect(screen.getByText('First Seen').nextElementSibling).toHaveTextContent('2023');
    });
    expect(screen.getByText('Last Seen').nextElementSibling).toHaveTextContent('2023');
    // Exactly the two boundary blocks — no more, no repeated calls.
    expect(getBlock).toHaveBeenCalledTimes(2);
    expect(getBlock).toHaveBeenNthCalledWith(1, { blockNumber: 100n });
    expect(getBlock).toHaveBeenNthCalledWith(2, { blockNumber: 200n });
    // A rerender over the same rows resolves from the module cache: the
    // RPC count stays at two.
    rerender(<SummaryStatsRow {...props} rows={rows} />);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(getBlock).toHaveBeenCalledTimes(2);
    rpcMocks.createRpcClient.mockClear();
    rerender(<SummaryStatsRow {...props} rows={rows} />);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(rpcMocks.createRpcClient).not.toHaveBeenCalled();
  });

  it('keeps the block-number fallback when the boundary lookup fails', async () => {
    rpcMocks.createRpcClient.mockRejectedValue(new Error('rpc down'));
    render(
      <SummaryStatsRow {...props} rows={[row({ blockNumber: '300', value: '1' })]} />,
    );
    // Give the failure path its async turns; the fallback must persist.
    await waitFor(
      () => {
        expect(rpcMocks.createRpcClient).toHaveBeenCalledTimes(1);
      },
      { timeout: 200 },
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.getByText('First Seen').nextElementSibling).toHaveTextContent('Block 300');
    expect(screen.getByText('Last Seen').nextElementSibling).toHaveTextContent('Block 300');
  });
});
