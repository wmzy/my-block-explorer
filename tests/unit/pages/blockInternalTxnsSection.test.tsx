// Block Detail "Internal Transactions (traced)" card: the on-demand
// callTracer sweep over a block's transactions, end-to-end at the
// component layer. The browser RPC client is mocked (traces and the tx
// list are ephemeral node data the card fetches via eth_getBlockByHash +
// debug_traceTransaction); pinned states: lazy sweep on first expand,
// per-tx grouped rows with value/selector/error text, the standing scope
// line, settled-result reuse on re-expand, the zero-transaction block
// (empty state WITHOUT tracing), the honest not-supported-by-this-RPC
// info state whose Retry genuinely re-probes, the tx-list fetch failure
// with Retry, per-tx trace failures listed collapsed, the 50-tx sweep
// cap's truncation line, and the bounded-concurrency pool.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';

import InternalTxnsSection from '@/views/Blocks/InternalTxnsSection';
import { createRpcClient } from '@/utils/realTimeData';

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(),
}));

const BLOCK_HASH = `0x${'cd'.repeat(32)}`;
const TX_A = `0x${'aa'.repeat(32)}`;
const TX_B = `0x${'bb'.repeat(32)}`;
const SENDER = '0x1111111111111111111111111111111111111111';
const TARGET = '0x2222222222222222222222222222222222222222';
const READER = '0x4444444444444444444444444444444444444444';

// Raw callTracer payloads (hex-string quantities) — the component's own
// normalizeCallTrace turns them into the typed tree.
// TX_A: a depth-1 value payout whose grandchild reverted.
const traceWithPayoutAndRevert = () => ({
  type: 'CALL',
  from: SENDER,
  to: TARGET,
  value: '0x0',
  gas: '0x8ac6f0',
  gasUsed: '0x186a0',
  input: '0x',
  calls: [
    {
      type: 'CALL',
      from: TARGET,
      to: READER,
      value: '0x6f05b59d3b20000', // 0.5 ETH
      gas: '0x5208',
      gasUsed: '0x5208',
      input: '0x',
      calls: [
        {
          type: 'CALL',
          from: READER,
          to: '0x5555555555555555555555555555555555555555',
          gas: '0x5208',
          gasUsed: '0x2b46',
          input: '0x',
          error: 'execution reverted',
          revertReason: 'INSUFFICIENT_ALLOWANCE',
        },
      ],
    },
  ],
});

// TX_B: a zero-value delegatecall with calldata — the row renders a '—'
// value cell and its selector.
const traceWithZeroValueDelegatecall = () => ({
  type: 'CALL',
  from: SENDER,
  to: TARGET,
  value: '0x0',
  gas: '0x8ac6f0',
  gasUsed: '0x186a0',
  input: '0x',
  calls: [
    {
      type: 'DELEGATECALL',
      from: TARGET,
      to: READER,
      gas: '0x2e248',
      gasUsed: '0x2b46',
      input: `0xa9059cbb${'00'.repeat(64)}`,
    },
  ],
});

const plainTransferTrace = () => ({
  type: 'CALL',
  from: SENDER,
  to: TARGET,
  value: '0xde0b6b3a7640000',
  gas: '0x5208',
  gasUsed: '0x5208',
  input: '0x',
});

const Blank = () => null;
const routes = createRoutes([
  { path: '/chain/:chainId/address/:address', component: () => Promise.resolve(Blank) },
  { path: '/chain/:chainId/tx/:txHash', component: () => Promise.resolve(Blank) },
]);

const requestMock = vi.fn<(args: { method: string; params: unknown[] }) => Promise<unknown>>();

// The block's tx list, answerable for any length (the cap cases build on it).
const blockWithTxs = (hashes: string[]) => ({
  number: '0x1',
  hash: BLOCK_HASH,
  transactions: hashes.map(hash => ({ hash })),
});

const renderSection = (props: { transactionCount?: number } = {}) =>
  render(
    <MemoryRouter routes={routes} initialEntries={['/chain/1/block/18000001']}>
      <InternalTxnsSection
        chainId={1}
        blockHash={BLOCK_HASH}
        transactionCount={props.transactionCount ?? 2}
      />
    </MemoryRouter>,
  );

const expand = () => fireEvent.click(screen.getByTestId('block-internal-txns-header'));

// Wires the two-request fixture: the block payload plus per-tx traces.
const mockHappySweep = () => {
  requestMock.mockImplementation(({ method, params }) => {
    if (method === 'eth_getBlockByHash') {
      return Promise.resolve(blockWithTxs([TX_A, TX_B]));
    }
    return Promise.resolve(
      params[0] === TX_A ? traceWithPayoutAndRevert() : traceWithZeroValueDelegatecall(),
    );
  });
};

describe('InternalTxnsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createRpcClient).mockResolvedValue({ request: requestMock } as never);
  });

  it('sweeps lazily on first expand and renders per-tx grouped internal calls', async () => {
    mockHappySweep();
    renderSection();

    // Collapsed mount: no RPC traffic at all.
    expect(vi.mocked(createRpcClient)).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();

    expand();

    // The tx list comes from the SAME block the page rendered (by hash).
    expect(
      await screen.findByTestId('block-internal-txns-summary'),
    ).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledWith({
      method: 'eth_getBlockByHash',
      params: [BLOCK_HASH, true],
    });

    // One callTracer request per block tx, in the shipped shape.
    expect(requestMock).toHaveBeenCalledWith({
      method: 'debug_traceTransaction',
      params: [TX_A, { tracer: 'callTracer' }],
    });
    expect(requestMock).toHaveBeenCalledWith({
      method: 'debug_traceTransaction',
      params: [TX_B, { tracer: 'callTracer' }],
    });

    // Standing scope line: provenance is stated in every phase.
    expect(screen.getByTestId('block-internal-txns-scope')).toHaveTextContent(
      'traced on demand from this node\'s debug API — internal calls only, not indexer data',
    );

    // Summary: every row counted, only txs actually traced named.
    expect(screen.getByTestId('block-internal-txns-summary')).toHaveTextContent(
      '3 internal calls across 2 traced transactions',
    );
    // Within the cap: no truncation line rendered.
    expect(screen.queryByTestId('block-internal-txns-cap')).not.toBeInTheDocument();

    // One group per tx that produced calls, header linking to the tx page.
    const groups = screen.getAllByTestId('block-internal-txns-group');
    expect(groups).toHaveLength(2);
    expect(
      screen.getByRole('link', { name: `0x${'a'.repeat(8)}...${'a'.repeat(8)}` }),
    ).toHaveAttribute('href', `/chain/1/tx/${TX_A}`);

    // Row contents: exact value, the zero-value row's '—', selector,
    // depth column, and the failed internal call's error text.
    expect(screen.getByText('0.5000 ETH')).toBeVisible();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText('0xa9059cbb')).toBeVisible();
    // One table per parent tx — each carries the full column set.
    expect(screen.getAllByRole('columnheader', { name: 'Depth' })).toHaveLength(2);
    expect(screen.getByText('error: execution reverted')).toBeVisible();
    expect(screen.getByText('revert: INSUFFICIENT_ALLOWANCE')).toBeVisible();
  });

  it('re-expands to the settled sweep without refetching', async () => {
    mockHappySweep();
    renderSection();

    expand();
    expect(await screen.findByTestId('block-internal-txns-summary')).toBeInTheDocument();
    const callsAfterSweep = requestMock.mock.calls.length;

    expand(); // collapse — content unmounts, settled state survives
    expect(screen.queryByTestId('block-internal-txns-summary')).not.toBeInTheDocument();

    expand(); // re-expand reuses the sweep: no new requests
    expect(await screen.findByTestId('block-internal-txns-summary')).toBeInTheDocument();
    expect(requestMock.mock.calls.length).toBe(callsAfterSweep);
  });

  it('renders the zero-tx empty state WITHOUT tracing', () => {
    requestMock.mockResolvedValue(blockWithTxs([]));
    renderSection({ transactionCount: 0 });

    expand();

    expect(screen.getByTestId('block-internal-txns-zero')).toHaveTextContent(
      'This block contains no transactions',
    );
    expect(screen.getByTestId('block-internal-txns-scope')).toBeInTheDocument();
    // The count the page already holds says there is nothing to trace:
    // no RPC call of any kind.
    expect(vi.mocked(createRpcClient)).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('renders the honest not-supported state (with retry) when the RPC lacks debug_*', async () => {
    requestMock.mockImplementation(({ method }) => {
      if (method === 'eth_getBlockByHash') return Promise.resolve(blockWithTxs([TX_A, TX_B]));
      return Promise.reject(
        Object.assign(
          new Error('the method debug_traceTransaction does not exist/is not available'),
          { code: -32601 },
        ),
      );
    });
    renderSection();

    expand();

    const unsupported = await screen.findByTestId('block-internal-txns-unsupported');
    expect(unsupported).toHaveTextContent(
      'Internal transaction tracing is not supported by this RPC',
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByTestId('block-internal-txns-summary')).not.toBeInTheDocument();

    // Retry genuinely re-probes the capability.
    mockHappySweep();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByTestId('block-internal-txns-summary'),
    ).toBeInTheDocument();
  });

  it('degrades a tx-list fetch failure to an error state whose Retry refetches', async () => {
    requestMock.mockImplementation(({ method }) => {
      if (method === 'eth_getBlockByHash') {
        return Promise.reject(new Error('Request failed: gateway timeout'));
      }
      return Promise.resolve(plainTransferTrace());
    });
    renderSection();

    expand();

    expect(
      await screen.findByText('Failed to fetch this block\'s transactions from the RPC.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('block-internal-txns-unsupported')).not.toBeInTheDocument();

    mockHappySweep();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByTestId('block-internal-txns-summary'),
    ).toBeInTheDocument();
    // The retried sweep really traced (not just refetched the list).
    expect(requestMock).toHaveBeenCalledWith({
      method: 'debug_traceTransaction',
      params: [TX_A, { tracer: 'callTracer' }],
    });
  });

  it('lists per-tx trace failures collapsed and keeps the settled groups', async () => {
    requestMock.mockImplementation(({ method, params }) => {
      if (method === 'eth_getBlockByHash') return Promise.resolve(blockWithTxs([TX_A, TX_B]));
      if (params[0] === TX_A) return Promise.resolve(traceWithPayoutAndRevert());
      return Promise.reject(new Error('Request failed: gateway timeout'));
    });
    renderSection();

    expand();

    const summary = await screen.findByTestId('block-internal-txns-summary');
    expect(summary).toHaveTextContent('2 internal calls across 1 traced transaction');
    expect(screen.getAllByTestId('block-internal-txns-group')).toHaveLength(1);

    // The failure card is present, collapsed by default (jsdom cannot
    // honor CSS display:none — collapse is pinned on aria-expanded).
    expect(screen.getByText('1 trace failure')).toBeInTheDocument();
    expect(screen.getByText(/Request failed: gateway timeout/)).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /1 trace failure/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // "Retry failed traces" re-runs the whole sweep.
    mockHappySweep();
    const callsBefore = requestMock.mock.calls.filter(
      call => call[0].method === 'debug_traceTransaction',
    ).length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed traces' }));
    const resweepSummary = await screen.findByTestId('block-internal-txns-summary');
    expect(resweepSummary).toHaveTextContent('3 internal calls across 2 traced transactions');
    expect(
      requestMock.mock.calls.filter(call => call[0].method === 'debug_traceTransaction')
        .length,
    ).toBe(callsBefore + 2);
  });

  it('traces at most 50 transactions and discloses the cut', async () => {
    const hashes = Array.from(
      { length: 60 },
      (_, i) => `0x${String(i).padStart(64, '0')}`,
    );
    requestMock.mockImplementation(({ method }) => {
      if (method === 'eth_getBlockByHash') return Promise.resolve(blockWithTxs(hashes));
      return Promise.resolve(traceWithPayoutAndRevert());
    });
    renderSection({ transactionCount: 60 });

    expand();

    const summary = await screen.findByTestId('block-internal-txns-summary');
    const debugCalls = requestMock.mock.calls.filter(
      call => call[0].method === 'debug_traceTransaction',
    );
    expect(debugCalls).toHaveLength(50);
    expect(summary).toHaveTextContent('100 internal calls across 50 traced transactions');

    // The honest truncation line: first 50 of the block's 60.
    expect(screen.getByTestId('block-internal-txns-cap')).toHaveTextContent(
      'first 50 of 60 transactions traced',
    );
  });

  it('never runs more than 4 traces in parallel', async () => {
    const hashes = Array.from({ length: 9 }, (_, i) => `0x${String(i).padStart(64, '0')}`);
    let active = 0;
    let peak = 0;
    requestMock.mockImplementation(async ({ method }) => {
      if (method === 'eth_getBlockByHash') return Promise.resolve(blockWithTxs(hashes));
      peak = Math.max(peak, (active += 1));
      await Promise.resolve();
      active -= 1;
      return plainTransferTrace();
    });
    renderSection({ transactionCount: 9 });

    expand();

    await screen.findByTestId('block-internal-txns-summary');
    const debugCalls = requestMock.mock.calls.filter(
      call => call[0].method === 'debug_traceTransaction',
    );
    expect(debugCalls).toHaveLength(9);
    expect(peak).toBeLessThanOrEqual(4);
  });
});
