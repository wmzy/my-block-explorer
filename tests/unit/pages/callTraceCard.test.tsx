// CallTraceCard: the tx-detail call-trace card's lazy fetch and honest
// degradation states, end-to-end at the component layer. The browser RPC
// client is mocked (traces are ephemeral node data the card fetches via
// debug_traceTransaction); every state — lazy expand, settled tree reuse,
// unsupported-method info, retryable failure, frameless result — is pinned
// without any network.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';

import { CallTraceCard } from '@/views/Transactions/CallTrace';
import { createRpcClient } from '@/utils/realTimeData';

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(),
}));

const TX_HASH = `0x${'ab'.repeat(32)}`;
const SENDER = '0x1111111111111111111111111111111111111111';
const TARGET = '0x2222222222222222222222222222222222222222';
const READER = '0x4444444444444444444444444444444444444444';

// Two-level fixture: root CALL transferring 1 ETH with an ERC-20 selector,
// one STATICCALL child reading totalSupply(), a deep grandchild that
// reverted — the full shape the tree renders.
const traceFixture = () => ({
  type: 'CALL',
  from: SENDER,
  to: TARGET,
  value: '0xde0b6b3a7640000', // 1 ETH
  gas: '0x8ac6f0',
  gasUsed: '0x186a0', // 100000
  input: `0xa9059cbb${'00'.repeat(64)}`,
  output: '0x',
  calls: [
    {
      type: 'STATICCALL',
      from: TARGET,
      to: READER,
      gas: '0x1d4c0',
      gasUsed: '0x5208', // 21000
      input: '0x18160ddd',
      output: `0x${'00'.repeat(31)}01`,
      calls: [
        {
          type: 'CALL',
          from: READER,
          to: '0x5555555555555555555555555555555555555555',
          gas: '0x5208',
          gasUsed: '0x2b46', // 11078
          input: '0x',
          error: 'execution reverted',
          revertReason: 'INSUFFICIENT_ALLOWANCE',
        },
      ],
    },
  ],
});

// The card renders address links through TypedLink, so it needs a router
// with the routes those links target.
const Blank = () => null;
const routes = createRoutes([
  { path: '/chain/:chainId/address/:address', component: () => Promise.resolve(Blank) },
  { path: '/chain/:chainId/tx/:txHash', component: () => Promise.resolve(Blank) },
]);

const requestMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();

const renderCard = (props: { txGasUsed?: string | null } = {}) =>
  render(
    <MemoryRouter routes={routes} initialEntries={['/chain/1/tx/0xdeadbeef']}>
      <CallTraceCard chainId={1} txHash={TX_HASH} txGasUsed={props.txGasUsed ?? '100000'} />
    </MemoryRouter>,
  );

const expand = () => fireEvent.click(screen.getByTestId('call-trace-header'));

describe('CallTraceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createRpcClient).mockResolvedValue({ request: requestMock } as never);
  });

  it('fetches lazily on first expand and renders the traced call tree', async () => {
    requestMock.mockResolvedValue(traceFixture());
    renderCard();

    // Collapsed mount: no RPC traffic at all.
    expect(vi.mocked(createRpcClient)).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
    expect(screen.queryByText('STATICCALL')).not.toBeInTheDocument();

    expand();

    // The callTracer request against the shared browser RPC client.
    expect(vi.mocked(createRpcClient)).toHaveBeenCalledWith(1);

    // Tree contents: type badges at both depths, address links, exact
    // value, selector, gas with its share of the tx's gasUsed.
    expect(await screen.findByText('STATICCALL')).toBeVisible();
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith({
      method: 'debug_traceTransaction',
      params: [TX_HASH, { tracer: 'callTracer' }],
    });
    // Root frame plus the reverting grandchild are both CALL frames.
    expect(screen.getAllByText('CALL')).toHaveLength(2);
    expect(screen.getByRole('link', { name: '0x222222…222222' })).toHaveAttribute(
      'href',
      `/chain/1/address/${TARGET}`,
    );
    expect(screen.getByRole('link', { name: '0x444444…444444' })).toHaveAttribute(
      'href',
      `/chain/1/address/${READER}`,
    );
    expect(screen.getByText('1.0000 ETH')).toBeVisible();
    expect(screen.getByText('0xa9059cbb')).toBeVisible();
    expect(screen.getByText('gas 100,000 · 100.0%')).toBeVisible();
    expect(screen.getByText('gas 21,000 · 21.0%')).toBeVisible();

    // Settled header summary: 3 frames, 2 levels deep, 1 failed.
    expect(screen.getByText('3 calls · depth 2 · 1 failed')).toBeVisible();

    // The deep revert is highlighted, not swallowed.
    expect(screen.getByText('error: execution reverted')).toBeVisible();
    expect(screen.getByText('revert: INSUFFICIENT_ALLOWANCE')).toBeVisible();
  });

  it('collapses to the header and re-expands to the settled trace without refetching', async () => {
    requestMock.mockResolvedValue(traceFixture());
    renderCard();

    expand();
    expect(await screen.findByText('STATICCALL')).toBeVisible();

    expand(); // collapse — content unmounts, settled state survives
    expect(screen.queryByText('STATICCALL')).not.toBeInTheDocument();

    expand(); // re-expand reuses the trace: still exactly one request
    expect(await screen.findByText('STATICCALL')).toBeVisible();
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('renders the honest not-supported info state for endpoints without tracing', async () => {
    requestMock.mockRejectedValueOnce(
      Object.assign(new Error('the method debug_traceTransaction does not exist/is not available'), {
        code: -32601,
      }),
    );
    renderCard();

    expand();

    const info = await screen.findByTestId('call-trace-unsupported');
    expect(info).toHaveTextContent('Call trace not supported by this RPC');
    // An unsupported method is a capability statement, not a failure —
    // no error card, nothing to retry.
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('degrades other failures to an error state whose Retry refetches', async () => {
    requestMock.mockRejectedValueOnce(new Error('gateway timeout'));
    renderCard();

    expand();
    expect(await screen.findByText('Failed to fetch the call trace from this RPC.')).toBeVisible();
    expect(screen.queryByTestId('call-trace-unsupported')).not.toBeInTheDocument();

    requestMock.mockResolvedValueOnce(traceFixture());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('STATICCALL')).toBeVisible();
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('reports frameless trace results as "No calls recorded"', async () => {
    requestMock.mockResolvedValueOnce(null);
    renderCard();

    expand();

    expect(await screen.findByTestId('call-trace-empty')).toHaveTextContent('No calls recorded.');
    expect(screen.queryByText('CALL')).not.toBeInTheDocument();
  });
});
