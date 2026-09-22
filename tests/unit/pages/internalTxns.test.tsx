// InternalTxns tab: on-demand tracing over the passed-in discovered
// window, end-to-end at the component layer. The browser RPC client is
// mocked (traces are ephemeral node data the tab fetches via
// debug_traceTransaction); pinned states: auto-run on mount with bounded
// concurrency, row rendering with the honest bounds label, the
// not-supported-by-this-RPC info state with retry, per-tx failures listed
// collapsed, source-list (loading/error/empty) states, and the refresh
// signal re-trace.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';

import InternalTxns, { TRACE_TX_LIMIT } from '@/views/Address/InternalTxns';
import { createRpcClient } from '@/utils/realTimeData';

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(),
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

const requestMock = vi.fn<(args: { method: string; params: unknown[] }) => Promise<unknown>>();

const defaultProps = () => ({
  chainId: 1,
  address: VIEWED,
  transactions: [{ hash: TX_A }, { hash: TX_B }],
  txLoading: false,
  txError: undefined as string | undefined,
  txPage: 1,
});

const renderTab = (props: Partial<ReturnType<typeof defaultProps>> = {}) =>
  render(
    <MemoryRouter routes={routes} initialEntries={['/chain/1/address/0xdeadbeef']}>
      <InternalTxns {...defaultProps()} {...props} />
    </MemoryRouter>,
  );

describe('InternalTxns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createRpcClient).mockResolvedValue({ request: requestMock } as never);
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

  it('traces at most TRACE_TX_LIMIT transactions of the window', async () => {
    requestMock.mockResolvedValue({ type: 'CALL', from: SENDER, to: TARGET, input: '0x' });
    renderTab({
      transactions: Array.from({ length: TRACE_TX_LIMIT + 3 }, (_, i) => ({
        hash: `0x${String(i).padStart(64, '0')}`,
      })),
    });

    const summary = await screen.findByTestId('internal-txns-summary');
    expect(requestMock).toHaveBeenCalledTimes(TRACE_TX_LIMIT);
    expect(summary).toHaveTextContent(
      `Traced the first ${TRACE_TX_LIMIT} discovered transactions`,
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
});
