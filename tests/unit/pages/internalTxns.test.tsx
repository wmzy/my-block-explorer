// InternalTxns tab: on-demand tracing over the passed-in discovered
// window, end-to-end at the component layer. The browser RPC client is
// mocked (traces are ephemeral node data the tab fetches via
// debug_traceTransaction); pinned states: auto-run on mount with bounded
// concurrency, row rendering with the honest bounds label, the
// not-supported-by-this-RPC info state with retry, per-tx failures listed
// collapsed, source-list (loading/error/empty) states, the refresh
// signal re-trace, the URL-driven trace depth (?itDepth= deep links,
// preset control writes, silent clamping), the live trace progress
// counter over the standing coverage line, and the deep-scan records
// section (persisted findings above the browser flow — rows with the
// verbatim scope note, absent on empty, one muted line on failure).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, createRoutes, useSearchParams } from '@native-router/react';
import '@testing-library/jest-dom';

import InternalTxns from '@/views/Address/InternalTxns';
import {
  DEFAULT_INTERNAL_TX_DEPTH,
  MAX_INTERNAL_TX_DEPTH,
  MIN_INTERNAL_TX_DEPTH,
} from '@/utils/internalTxScan';
import type { InternalTxRecord, InternalTxnsResult } from '@/services/addressScan';
import { createRpcClient } from '@/utils/realTimeData';

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  fetchInternalTransactions: vi.fn(),
}));

// Only the service edge is replaced: the tab's records plumbing (fetch
// on mount, absent-when-empty, non-fatal failure) stays real.
vi.mock('@/services/addressScan', () => ({
  fetchInternalTransactions: (...args: unknown[]) => mocks.fetchInternalTransactions(...args),
}));

const VIEWED = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SENDER = '0x1111111111111111111111111111111111111111';
const TARGET = '0x2222222222222222222222222222222222222222';

const TX_A = `0x${'aa'.repeat(32)}`;
const TX_B = `0x${'bb'.repeat(32)}`;

// Raw callTracer payloads (hex-string quantities) — the component's own
// normalizeCallTrace turns them into the typed tree.
const traceWithInternalPayout = () => ({
  type: 'CALL',
  from: SENDER,
  to: TARGET,
  value: '0x0',
  gas: '0x8ac6f0',
  gasUsed: '0x186a0',
  input: '0x',
  calls: [
    {
      // The internal transfer the tab exists for: value to the viewed
      // address, one nesting level down.
      type: 'CALL',
      from: TARGET,
      to: VIEWED,
      value: '0x6f05b59d3b20000', // 0.5 ETH (half of 0xde0b6b3a7640000)
      gas: '0x5208',
      gasUsed: '0x5208',
      input: '0x',
    },
  ],
});

const traceWithValueCarryingUnrelatedCall = () => ({
  type: 'CALL',
  from: SENDER,
  to: TARGET,
  value: '0x0',
  gas: '0x8ac6f0',
  gasUsed: '0x186a0',
  input: '0x',
  calls: [
    {
      // Value-carrying but neither endpoint is the viewed address: still
      // a row (the value filter is a row source of its own).
      type: 'DELEGATECALL',
      from: TARGET,
      to: '0x3333333333333333333333333333333333333333',
      value: '0x1',
      gas: '0x5208',
      gasUsed: '0x2b46',
      input: '0x',
    },
  ],
});

const Blank = () => null;
const routes = createRoutes([
  { path: '/chain/:chainId/address/:address', component: () => Promise.resolve(Blank) },
  { path: '/chain/:chainId/tx/:txHash', component: () => Promise.resolve(Blank) },
]);

// Exposes the live search string so cases can pin ?itDepth= round-trips
// through the URL (memory history is not window.location).
function SearchProbe() {
  const [params] = useSearchParams();
  return <div data-testid="search-probe">{params.toString()}</div>;
}

const requestMock = vi.fn<(args: { method: string; params: unknown[] }) => Promise<unknown>>();

const defaultProps = () => ({
  chainId: 1,
  address: VIEWED,
  transactions: [{ hash: TX_A }, { hash: TX_B }],
  txLoading: false,
  txError: undefined as string | undefined,
  txPage: 1,
});

const renderTab = (
  props: Partial<ReturnType<typeof defaultProps>> = {},
  search = '',
) =>
  render(
    <MemoryRouter
      routes={routes}
      initialEntries={[`/chain/1/address/0xdeadbeef${search}`]}
    >
      <SearchProbe />
      <InternalTxns {...defaultProps()} {...props} />
    </MemoryRouter>,
  );

describe('InternalTxns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createRpcClient).mockResolvedValue({ request: requestMock } as never);
    // No recorded findings by default: the records section stays absent
    // so every pre-existing browser-flow pin runs byte-identical.
    mocks.fetchInternalTransactions.mockReset().mockResolvedValue(null);
  });

  it('traces on mount, renders rows and the honest bounds label', async () => {
    requestMock.mockImplementation(({ params }) =>
      Promise.resolve(
        params[0] === TX_A
          ? traceWithInternalPayout()
          : traceWithValueCarryingUnrelatedCall(),
      ),
    );
    renderTab();

    // Aggregate header + the v1 scope disclosure (page 1 → "the first N").
    const summary = await screen.findByTestId('internal-txns-summary');
    expect(summary).toHaveTextContent(
      '2 internal transfers across 2 traced transactions',
    );
    expect(summary).toHaveTextContent('Traced the first 2 discovered transactions');

    // One callTracer request per discovered tx, in the shipped shape.
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock).toHaveBeenCalledWith({
      method: 'debug_traceTransaction',
      params: [TX_A, { tracer: 'callTracer' }],
    });

    // Rows: value transfer to the viewed address, plus the value-carrying
    // unrelated frame — type badges, address links, formatted value, depth.
    expect(screen.getAllByText('CALL')).toHaveLength(1);
    expect(screen.getAllByText('DELEGATECALL')).toHaveLength(1);
    expect(screen.getByText('0.5000 ETH')).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Parent Tx' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Depth' })).toBeInTheDocument();
  });

  it('never runs more than 4 traces in parallel', async () => {
    let active = 0;
    let peak = 0;
    requestMock.mockImplementation(async () => {
      peak = Math.max(peak, (active += 1));
      await Promise.resolve();
      active -= 1;
      return traceWithInternalPayout();
    });
    renderTab({
      transactions: Array.from({ length: 9 }, (_, i) => ({
        hash: `0x${String(i).padStart(64, '0')}`,
      })),
    });

    await screen.findByTestId('internal-txns-summary');
    expect(requestMock).toHaveBeenCalledTimes(9);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it(`traces at most ${DEFAULT_INTERNAL_TX_DEPTH} transactions of the window`, async () => {
    requestMock.mockResolvedValue({ type: 'CALL', from: SENDER, to: TARGET, input: '0x' });
    renderTab({
      transactions: Array.from({ length: DEFAULT_INTERNAL_TX_DEPTH + 3 }, (_, i) => ({
        hash: `0x${String(i).padStart(64, '0')}`,
      })),
    });

    const summary = await screen.findByTestId('internal-txns-summary');
    expect(requestMock).toHaveBeenCalledTimes(DEFAULT_INTERNAL_TX_DEPTH);
    expect(summary).toHaveTextContent(
      `Traced the first ${DEFAULT_INTERNAL_TX_DEPTH} discovered transactions`,
    );
  });

  it('names the page in the scope label when the window is a deeper page', async () => {
    requestMock.mockResolvedValue({ type: 'CALL', from: SENDER, to: TARGET, input: '0x' });
    renderTab({ txPage: 3 });

    const summary = await screen.findByTestId('internal-txns-summary');
    expect(summary).toHaveTextContent(
      'Traced 2 discovered transactions (page 3 of the discovered set)',
    );
  });

  it('renders the honest not-supported state (with retry) when the RPC lacks debug_*', async () => {
    requestMock.mockRejectedValue(
      Object.assign(
        new Error('the method debug_traceTransaction does not exist/is not available'),
        { code: -32601 },
      ),
    );
    renderTab();

    const unsupported = await screen.findByTestId('internal-txns-unsupported');
    expect(unsupported).toHaveTextContent(
      'Internal transaction tracing is not supported by this RPC',
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    // Retry genuinely re-probes the capability.
    requestMock.mockResolvedValue(traceWithInternalPayout());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByTestId('internal-txns-summary'),
    ).toBeInTheDocument();
  });

  it('lists per-tx trace failures collapsed, not hidden, and keeps the settled rows', async () => {
    requestMock.mockImplementation(({ params }) =>
      params[0] === TX_A
        ? Promise.resolve(traceWithInternalPayout())
        : Promise.reject(new Error('Request failed: gateway timeout')),
    );
    renderTab();

    const summary = await screen.findByTestId('internal-txns-summary');
    expect(summary).toHaveTextContent('1 internal transfer across 1 traced transaction');

    // The failure card is present, collapsed by default (jsdom cannot
    // honor the CSS display:none — collapse is pinned on aria-expanded).
    expect(screen.getByText('1 trace failure')).toBeInTheDocument();
    expect(screen.getByText(/Request failed: gateway timeout/)).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /1 trace failure/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders an honest empty state when traces settle without internal rows', async () => {
    requestMock.mockResolvedValue({
      type: 'CALL',
      from: SENDER,
      to: TARGET,
      value: '0x0',
      input: '0x',
      calls: [],
    });
    renderTab();

    expect(
      await screen.findByText(/No internal transfers found in the traced transactions/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/not a claim that the address has none/),
    ).toBeInTheDocument();
  });

  it('waits for the source list instead of tracing half a window', () => {
    requestMock.mockResolvedValue(traceWithInternalPayout());
    renderTab({ txLoading: true });

    expect(screen.getByText('Scanning recent chain history...')).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('surfaces a source-list error verbatim instead of tracing', () => {
    renderTab({ txError: 'HTTP 500' });

    expect(
      screen.getByText(/The discovered transaction list failed \(HTTP 500\)/),
    ).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('says "nothing to trace" without claiming the address has no internal txs', () => {
    renderTab({ transactions: [] });

    expect(
      screen.getByText(/No discovered transactions in the current window/),
    ).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('re-traces on a refresh-signal bump and reports back', async () => {
    requestMock.mockResolvedValue(traceWithInternalPayout());
    const onRefreshed = vi.fn();
    const { rerender } = render(
      <MemoryRouter routes={routes} initialEntries={['/chain/1/address/0xdeadbeef']}>
        <InternalTxns {...defaultProps()} refreshSignal={0} onRefreshed={onRefreshed} />
      </MemoryRouter>,
    );
    await screen.findByTestId('internal-txns-summary');
    expect(requestMock).toHaveBeenCalledTimes(2);

    rerender(
      <MemoryRouter routes={routes} initialEntries={['/chain/1/address/0xdeadbeef']}>
        <InternalTxns {...defaultProps()} refreshSignal={1} onRefreshed={onRefreshed} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledTimes(4);
    });
    await waitFor(() => {
      expect(onRefreshed).toHaveBeenCalled();
    });
  });

  it('shows the standing coverage line (depth cap included) in every phase', () => {
    // Even while the source list is still loading — the explanation of
    // why the list may be short never hides behind a collapsed section.
    renderTab({ txLoading: true });

    const note = screen.getByTestId('internal-txns-scope-note');
    expect(note).toHaveTextContent(
      `first ${DEFAULT_INTERNAL_TX_DEPTH.toLocaleString()} discovered transactions`,
    );
    expect(note).toHaveTextContent('not full indexing');
    // The depth control sits beside the line, so the cap is adjustable.
    expect(
      screen.getByRole('combobox', { name: 'Trace depth' }),
    ).toHaveValue(String(DEFAULT_INTERNAL_TX_DEPTH));
  });

  it('names the window length when it exceeds the depth (honest truncation)', async () => {
    requestMock.mockResolvedValue({ type: 'CALL', from: SENDER, to: TARGET, input: '0x' });
    renderTab({
      transactions: Array.from({ length: DEFAULT_INTERNAL_TX_DEPTH + 3 }, (_, i) => ({
        hash: `0x${String(i).padStart(64, '0')}`,
      })),
    });

    await screen.findByTestId('internal-txns-summary');
    expect(screen.getByTestId('internal-txns-scope-note')).toHaveTextContent(
      `window holds ${(DEFAULT_INTERNAL_TX_DEPTH + 3).toLocaleString()}`,
    );
  });

  it('seeds the trace depth from a shared ?itDepth= deep link', async () => {
    requestMock.mockResolvedValue({ type: 'CALL', from: SENDER, to: TARGET, input: '0x' });
    renderTab(
      {
        transactions: Array.from({ length: 60 }, (_, i) => ({
          hash: `0x${String(i).padStart(64, '0')}`,
        })),
      },
      '?itDepth=50',
    );

    const summary = await screen.findByTestId('internal-txns-summary');
    expect(requestMock).toHaveBeenCalledTimes(50);
    expect(summary).toHaveTextContent('Traced the first 50 discovered transactions');
    expect(screen.getByRole('combobox', { name: 'Trace depth' })).toHaveValue('50');
  });

  it('silently clamps out-of-range ?itDepth= deep links into the supported range', async () => {
    requestMock.mockResolvedValue({ type: 'CALL', from: SENDER, to: TARGET, input: '0x' });
    renderTab(
      {
        transactions: Array.from({ length: MAX_INTERNAL_TX_DEPTH + 5 }, (_, i) => ({
          hash: `0x${String(i).padStart(64, '0')}`,
        })),
      },
      `?itDepth=${MAX_INTERNAL_TX_DEPTH + 99}`,
    );

    const summary = await screen.findByTestId('internal-txns-summary');
    expect(requestMock).toHaveBeenCalledTimes(MAX_INTERNAL_TX_DEPTH);
    expect(summary).toHaveTextContent(
      `Traced the first ${MAX_INTERNAL_TX_DEPTH} discovered transactions`,
    );
  });

  it('raises a sub-floor ?itDepth= deep link to the minimum depth', async () => {
    requestMock.mockResolvedValue({ type: 'CALL', from: SENDER, to: TARGET, input: '0x' });
    renderTab(
      {
        transactions: Array.from({ length: MIN_INTERNAL_TX_DEPTH + 2 }, (_, i) => ({
          hash: `0x${String(i).padStart(64, '0')}`,
        })),
      },
      '?itDepth=9',
    );

    const summary = await screen.findByTestId('internal-txns-summary');
    expect(requestMock).toHaveBeenCalledTimes(MIN_INTERNAL_TX_DEPTH);
    expect(summary).toHaveTextContent(
      `Traced the first ${MIN_INTERNAL_TX_DEPTH} discovered transactions`,
    );
  });

  it('offers a between-preset deep-linked depth as its own truthful option', () => {
    requestMock.mockResolvedValue({ type: 'CALL', from: SENDER, to: TARGET, input: '0x' });
    renderTab(
      {
        transactions: Array.from({ length: 60 }, (_, i) => ({
          hash: `0x${String(i).padStart(64, '0')}`,
        })),
      },
      '?itDepth=42',
    );

    const select = screen.getByRole('combobox', { name: 'Trace depth' });
    expect(select).toHaveValue('42');
    expect(screen.getByRole('option', { name: '42' })).toBeInTheDocument();
  });

  it('writes the chosen depth into ?itDepth= (pinned to the internal tab) and re-scans', async () => {
    requestMock.mockResolvedValue({ type: 'CALL', from: SENDER, to: TARGET, input: '0x' });
    renderTab({
      transactions: Array.from({ length: 60 }, (_, i) => ({
        hash: `0x${String(i).padStart(64, '0')}`,
      })),
    });

    await screen.findByTestId('internal-txns-summary');
    expect(requestMock).toHaveBeenCalledTimes(DEFAULT_INTERNAL_TX_DEPTH);

    fireEvent.change(screen.getByRole('combobox', { name: 'Trace depth' }), {
      target: { value: '50' },
    });

    // The depth rides the URL (shareable, refresh-stable) and the write
    // keeps the deep link landing on this tab.
    await waitFor(() =>
      expect(screen.getByTestId('search-probe')).toHaveTextContent('itDepth=50'),
    );
    expect(screen.getByTestId('search-probe')).toHaveTextContent('tab=internal');

    // A different slice is a different universe: the wider depth re-scans.
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(75));
    const summary = await screen.findByTestId('internal-txns-summary');
    expect(summary).toHaveTextContent('Traced the first 50 discovered transactions');
  });

  it('renders live trace progress as "Traced X of N transactions" while the pool settles', async () => {
    let releaseSecond: (() => void) | undefined;
    requestMock.mockImplementation(({ params }) => {
      if (params[0] === TX_A) return Promise.resolve(traceWithInternalPayout());
      return new Promise(resolve => {
        releaseSecond = () => resolve(traceWithInternalPayout());
      });
    });
    renderTab();

    // First tx settled, second still tracing: the counter is live.
    expect(await screen.findByText('Traced 1 of 2 transactions…')).toBeInTheDocument();

    releaseSecond?.();
    expect(await screen.findByTestId('internal-txns-summary')).toBeInTheDocument();
  });
});

// Deep-scan records: persisted internal-tx findings fetched once per
// chain/address and stacked ABOVE the browser tracing flow. The three
// contract states — rows with the honest scope note, absent on empty,
// non-fatal failure line — never replace the existing flow.
describe('InternalTxns deep-scan records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createRpcClient).mockResolvedValue({ request: requestMock } as never);
    mocks.fetchInternalTransactions.mockReset().mockResolvedValue(null);
  });

  const record = (partial: Partial<InternalTxRecord> = {}): InternalTxRecord => ({
    transactionHash: TX_A,
    blockNumber: 19_000_000,
    from: SENDER,
    to: VIEWED,
    value: '500000000000000000', // 0.5 ETH
    callType: 'call',
    reverted: false,
    tracePath: '0.1',
    timestamp: '2026-09-20T12:00:00.000Z',
    ...partial,
  });

  const recordsBody = (
    transactions: InternalTxRecord[],
    total = transactions.length,
  ): InternalTxnsResult => ({ transactions, total, offset: 0, limit: 50 });

  it('renders the records section above the browser flow with rows and the verbatim scope note', async () => {
    // The browser flow traces but finds nothing: its table stays empty, so
    // every row assertion below is unambiguously the records section's.
    requestMock.mockResolvedValue({
      type: 'CALL',
      from: SENDER,
      to: TARGET,
      value: '0x0',
      input: '0x',
      calls: [],
    });
    mocks.fetchInternalTransactions.mockResolvedValue(
      recordsBody(
        [
          record(),
          record({
            transactionHash: TX_B,
            from: VIEWED,
            to: TARGET,
            callType: 'staticcall',
            reverted: true,
            value: '0',
          }),
        ],
        120,
      ),
    );
    renderTab();

    const section = await screen.findByTestId('deep-scan-records');
    expect(screen.getByText('Deep scan records')).toBeInTheDocument();
    // The honest scope note, verbatim from the assignment.
    expect(section).toHaveTextContent(
      'recorded while deep-scanning blocks where this address changed — internal calls to this address inside unrelated transactions in non-scanned blocks are not included',
    );

    // Rows: tx hash links, value formatting, callType chips, reverted marker.
    expect(screen.getByText('0xaaaaaaaa...aaaaaaaa')).toBeInTheDocument();
    expect(screen.getByText('0xbbbbbbbb...bbbbbbbb')).toBeInTheDocument();
    expect(screen.getByText('0.5000 ETH')).toBeInTheDocument();
    expect(screen.getByText('call')).toBeInTheDocument();
    expect(screen.getByText('staticcall')).toBeInTheDocument();
    expect(screen.getByText('reverted')).toBeInTheDocument();
    // Honest disclosure when the fetch holds fewer rows than the total.
    expect(section).toHaveTextContent('Showing 2 of 120');

    // The fetch rode the pinned query (first page) against this address.
    expect(mocks.fetchInternalTransactions).toHaveBeenCalledWith(1, VIEWED, {
      offset: 0,
      limit: 50,
    });

    // The browser flow still renders below (its own summary line).
    expect(await screen.findByTestId('internal-txns-summary')).toBeInTheDocument();
  });

  it('keeps the section absent on an empty result — the browser flow stays byte-identical', async () => {
    requestMock.mockResolvedValue(traceWithInternalPayout());
    mocks.fetchInternalTransactions.mockResolvedValue(recordsBody([]));
    renderTab();

    expect(await screen.findByTestId('internal-txns-summary')).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.fetchInternalTransactions).toHaveBeenCalledWith(1, VIEWED, {
        offset: 0,
        limit: 50,
      }),
    );
    expect(screen.queryByTestId('deep-scan-records')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Deep-scan records are unavailable right now'),
    ).not.toBeInTheDocument();
  });

  it('downgrades a fetch failure to one muted line and keeps the browser flow', async () => {
    requestMock.mockResolvedValue(traceWithInternalPayout());
    mocks.fetchInternalTransactions.mockRejectedValue(new Error('HTTP 502'));
    renderTab();

    expect(
      await screen.findByText('Deep-scan records are unavailable right now'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('deep-scan-records')).not.toBeInTheDocument();
    expect(await screen.findByTestId('internal-txns-summary')).toBeInTheDocument();
  });
});
