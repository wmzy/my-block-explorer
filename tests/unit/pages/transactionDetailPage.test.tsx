// Transaction detail page tests: the view under a minimal native-router
// harness with services and network-adjacent children mocked. Covers the
// four enrichment surfaces (function call, event logs, revert reason,
// created contract) plus the not-found card's three-cause breakdown — real
// txDecode and viem codecs are exercised against realistic ABI-encoded
// fixtures.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import { encodeFunctionData, toEventSelector, type Abi, type Hex } from 'viem';
import '@testing-library/jest-dom';

import TransactionDetail from '@/views/Transactions/Detail';
import { useContractSource } from '@/services/contracts';
import { useTransactionByHash } from '@/services/chainRpc';
import { createRpcClient } from '@/utils/realTimeData';

vi.mock('@/services/contracts', () => ({
  useContractSource: vi.fn(),
}));

vi.mock('@/services/chainRpc', () => ({
  useTransactionByHash: vi.fn(),
}));

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(),
}));

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">chain: {currentChainId}</div>
  ),
}));

vi.mock('@/components/ui/CopyableHash', () => ({
  CopyableHash: ({
    value,
    truncated,
    href,
  }: {
    value: string;
    truncated?: string;
    href?: string;
  }) => (href ? <a href={href}>{truncated ?? value}</a> : <span>{truncated ?? value}</span>),
}));

vi.mock('@/config/chains', () => ({
  getChainInfo: (chainId: number) => {
    if (chainId === 1) return { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } };
    return null;
  },
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : `Chain ${chainId}`),
  getChainSymbol: () => 'ETH',
  // Consumed by the Landing helpers behind UnsupportedChainState.
  isChainSupported: (chainId: number) => chainId === 1,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
  // Quick re-check links in the not-found card (current chain filtered out).
  POPULAR_CHAINS: [
    { id: 1, name: 'Ethereum' },
    { id: 137, name: 'Polygon' },
    { id: 8453, name: 'Base' },
    { id: 42161, name: 'Arbitrum One' },
    { id: 10, name: 'Optimism' },
  ],
}));

const TOKEN = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const SENDER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const CREATED = '0x3333333333333333333333333333333333333333';
const TX_HASH = '0xtxhash0000000000000000000000000000000000000000000000000000000000';

const abiJson = JSON.stringify([
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
]);
const parsedAbi = JSON.parse(abiJson) as Abi;

const AMOUNT = 1000000n;
const inputData = encodeFunctionData({
  abi: parsedAbi,
  functionName: 'transfer',
  args: [RECIPIENT, AMOUNT],
});

// Canonical ERC-20 Transfer receipt log: indexed from/to in topics, the
// uint256 value as the single non-indexed data word.
const transferTopic0 = toEventSelector('Transfer(address,address,uint256)');
const addressTopic = (addr: string): Hex => `0x${addr.slice(2).toLowerCase().padStart(64, '0')}`;
const transferLog = {
  address: TOKEN,
  topics: [transferTopic0, addressTopic(SENDER), addressTopic(RECIPIENT)],
  data: `0x${AMOUNT.toString(16).padStart(64, '0')}`,
  logIndex: '0',
};

// Hand-rolled ABI encoding of Error(string) — what `revert("…")` emits.
const errorStringPayload = (reason: string): string => {
  const body = Array.from(new TextEncoder().encode(reason), b =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  const word = (n: number) => n.toString(16).padStart(64, '0');
  return `0x08c379a0${word(32)}${word(reason.length)}${body.padEnd(64, '0')}`;
};

const verifiedSourceResponse = {
  contractSource: {
    chainId: 1,
    address: TOKEN,
    name: 'TestToken',
    abi: abiJson,
    verificationStatus: 'verified',
  },
};

// Logs arrive as plain untyped objects on the RPC transaction fixture.
const makeTx = (overrides: Record<string, unknown> = {}) =>
  ({
    hash: TX_HASH,
    blockNumber: '18000001',
    transactionIndex: 5,
    fromAddress: SENDER,
    toAddress: TOKEN,
    value: '0',
    gasLimit: '50000',
    gasUsed: '30000',
    gasPrice: '20000000000',
    nonce: 42,
    type: 2,
    status: 1,
    inputData,
    logs: [],
    ...overrides,
  }) as never;

const hookResult = (data: unknown, error?: unknown) =>
  ({ data, loading: false, error, refetch: vi.fn() }) as unknown as never;

const mockRpcClient = (call: ReturnType<typeof vi.fn>) => {
  vi.mocked(createRpcClient).mockResolvedValue({ call } as never);
};

// The back button's fallback destination.
const TxListStub = () => <div data-testid="tx-list" />;

function renderDetail(path = `/chain/1/tx/${TX_HASH}`) {
  const routes = createRoutes([
    { path: '/chain/:chainId/tx/:txHash', component: () => TransactionDetail },
    { path: '/chain/:chainId/transactions', component: () => TxListStub },
  ]);
  return render(
    <MemoryRouter routes={routes} initialEntries={[path]}>
      <View />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useTransactionByHash).mockReturnValue(hookResult(makeTx()));
  vi.mocked(useContractSource).mockReturnValue(hookResult(verifiedSourceResponse));
});

describe('TransactionDetail page', () => {
  it('renders selector, decoded function, raw input and decoded event logs for a verified contract call', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(hookResult(makeTx({ logs: [transferLog] })));

    renderDetail();

    // Function call card: selector row, decoded signature row, raw hex.
    expect(await screen.findByRole('heading', { name: 'Function Call' })).toBeInTheDocument();
    expect(screen.getByText(inputData.slice(0, 10))).toBeInTheDocument();
    expect(screen.getByText(`transfer(${RECIPIENT}, 1000000)`)).toBeInTheDocument();
    expect(screen.getByText(inputData)).toBeInTheDocument();

    // Event logs card: decoded Transfer entry + emitter address link (a log
    // emitter is by definition a contract, so it targets the contract view).
    expect(await screen.findByRole('heading', { name: 'Event Logs' })).toBeInTheDocument();
    expect(
      screen.getByText(`Transfer(${SENDER}, ${RECIPIENT}, ${AMOUNT.toString()})`),
    ).toBeInTheDocument();
    // From/To rows are copyable links into the address view.
    expect(screen.getByRole('link', { name: SENDER })).toHaveAttribute(
      'href',
      `/chain/1/address/${SENDER}`,
    );
    // To and the log emitter are the same address here: the To row points
    // at the address view, the emitter at the contract view.
    const tokenLinks = screen.getAllByRole('link', { name: TOKEN });
    expect(tokenLinks.map(link => link.getAttribute('href'))).toEqual(
      expect.arrayContaining([`/chain/1/address/${TOKEN}`, `/chain/1/contract/${TOKEN}`]),
    );
  });

  it('degrades to raw-only for an unverified to-contract without error UI', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(hookResult(makeTx({ logs: [transferLog] })));
    // Backend answers 404 for unverified sources: error set, data undefined.
    vi.mocked(useContractSource).mockReturnValue(
      hookResult(undefined, new Error('Request failed with status code 404')),
    );

    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Function Call' })).toBeInTheDocument();
    expect(screen.getByText(inputData.slice(0, 10))).toBeInTheDocument();
    expect(screen.getByText(inputData)).toBeInTheDocument();
    // No decoded function row and no error state anywhere.
    expect(screen.queryByText('Function')).not.toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();

    // Event log falls back to raw topics + data; topic0 becomes an external
    // openchain signature lookup for the unknown selector.
    expect(await screen.findByRole('heading', { name: 'Event Logs' })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(transferTopic0.slice(2)))).toBeInTheDocument();
    const topic0Link = screen.getByRole('link', { name: new RegExp(transferTopic0.slice(2)) });
    expect(topic0Link).toHaveAttribute(
      'href',
      `https://openchain.xyz/signatures?query=${transferTopic0}`,
    );
    expect(topic0Link).toHaveAttribute('target', '_blank');
    expect(topic0Link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('decodes the revert reason of a failed transaction from a replayed call', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(hookResult(makeTx({ status: 0 })));
    vi.mocked(useContractSource).mockReturnValue(hookResult(undefined));
    // viem-style cause chain: the raw payload sits on an inner error's data.
    const inner = Object.assign(new Error('RPC error'), {
      data: errorStringPayload('Insufficient balance'),
    });
    const rpcError = new Error('execution reverted', { cause: inner });
    mockRpcClient(vi.fn().mockRejectedValue(rpcError));

    renderDetail();

    expect(
      await screen.findByRole('heading', { name: 'Revert Reason (best effort)' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Insufficient balance')).toBeInTheDocument();
  });

  it('reports an honest unavailable note when the replay resolves without reverting', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(hookResult(makeTx({ status: 0 })));
    vi.mocked(useContractSource).mockReturnValue(hookResult(undefined));
    mockRpcClient(vi.fn().mockResolvedValue('0x'));

    renderDetail();

    expect(await screen.findByText(/Reason unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/archive state/)).toBeInTheDocument();
  });

  it('links the created contract address of a contract-creation transaction', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(makeTx({ toAddress: '', inputData: '0x', contractAddress: CREATED })),
    );

    renderDetail();

    expect(await screen.findByText('Created Contract')).toBeInTheDocument();
    // An empty To renders the creation label instead of a broken link.
    expect(screen.getByText('Contract Creation')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: CREATED });
    expect(link).toHaveAttribute('href', `/chain/1/contract/${CREATED}`);
    // Creation carries no call data: no function-call or event-log cards.
    expect(screen.queryByRole('heading', { name: 'Function Call' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Event Logs' })).not.toBeInTheDocument();
  });

  it('splits the not-found card into the three real causes, each with its own recovery path', async () => {
    const refetch = vi.fn();
    vi.mocked(useTransactionByHash).mockReturnValue({
      data: undefined,
      loading: false,
      error: {
        name: 'TransactionNotFoundError',
        message: `Transaction with hash "${TX_HASH}" could not be found.`,
      },
      refetch,
    } as unknown as never);

    renderDetail();

    // Card + honest intro sentence naming the chain that was searched.
    expect(
      await screen.findByRole('heading', { name: 'Transaction Not Found' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'No transaction with this hash is known to Ethereum. This usually means one of three things:',
      ),
    ).toBeInTheDocument();

    // The hash itself stays visible (copyable) — without a found
    // transaction this card is the only place it appears on the page.
    const truncatedHash = `${TX_HASH.slice(0, 10)}…${TX_HASH.slice(-8)}`;
    expect(screen.getByText(truncatedHash)).toBeInTheDocument();

    // Three causes, one line each.
    expect(screen.getByText('Still pending.')).toBeInTheDocument();
    expect(screen.getByText('Different network.')).toBeInTheDocument();
    expect(screen.getByText('Reorged out.')).toBeInTheDocument();

    // Pending path: an explicit retry that re-runs the query.
    fireEvent.click(screen.getByRole('button', { name: 'try again' }));
    expect(refetch).toHaveBeenCalled();

    // Wrong-network path: cross-chain search link + same-hash quick links
    // to the popular chains other than the current one.
    const searchLink = screen.getByRole('link', { name: 'search across chains' });
    expect(searchLink).toHaveAttribute('href', '/search');
    expect(screen.queryByRole('button', { name: 'Ethereum' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Polygon' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Base' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Arbitrum One' })).toBeInTheDocument();
    // Reorg path: pointed at the block list to check for an orphaned block.
    const blockListLink = screen.getByRole('link', { name: 'the block list' });
    expect(blockListLink).toHaveAttribute('href', '/chain/1/blocks');

    // A quick link re-resolves this exact hash on the target chain (the
    // mock chain table knows only chain 1, so 137 lands on the
    // unsupported-chain recovery state — proof the navigation ran).
    fireEvent.click(screen.getByRole('button', { name: 'Polygon' }));
    expect(await screen.findByText(/Chain not supported/)).toBeInTheDocument();

    // The raw provider error never leaks into the friendly card.
    expect(screen.queryByText(/could not be found/)).not.toBeInTheDocument();
  });

  it('keeps the raw error state for genuine RPC failures', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(undefined, new Error('RPC connection refused')),
    );

    renderDetail();

    expect(await screen.findByText('RPC connection refused')).toBeInTheDocument();
    expect(screen.queryByText(/Transaction not found on/)).not.toBeInTheDocument();
  });

  it('renders the unsupported-chain recovery state with CTAs instead of a bare error', async () => {
    // Bad chainId deep link: recovery CTAs (Home/Blocks pattern). The
    // wrong-chain "Transaction Not Found" card is a different, legit case
    // and keeps its own copy.
    renderDetail(`/chain/999/tx/${TX_HASH}`);

    expect(await screen.findByText(/Chain not supported/)).toBeInTheDocument();
    expect(screen.getByText(/chain ID 999/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Mainnet' })).toHaveAttribute('href', '/chain/1');
    expect(screen.getByRole('link', { name: 'Open chain list' })).toHaveAttribute('href', '/');
  });

  it('renders a pending transaction with Pending block rows instead of 0', async () => {
    // Pending shape: no block position, no receipt, no timestamp.
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(
        makeTx({
          blockNumber: null,
          transactionIndex: null,
          status: -1,
          timestamp: undefined,
          gasUsed: undefined,
          effectiveGasPrice: undefined,
        }),
      ),
    );

    renderDetail();

    // Block Number / Transaction Index rows show honest Pending text:
    // no "0" (the old fallback) and no timestamp row at all.
    const pendings = await screen.findAllByText('Pending');
    expect(pendings.length).toBe(3); // status badge + block number + index
    expect(screen.queryByText('Transaction Type 0')).not.toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
    expect(screen.queryByText('Timestamp')).not.toBeInTheDocument();
    // A pending tx (status -1) never triggers the failed-tx revert card.
    expect(
      screen.queryByRole('heading', { name: 'Revert Reason (best effort)' }),
    ).not.toBeInTheDocument();
  });

  it('labels type-4 transactions EIP-7702', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(hookResult(makeTx({ type: 4 })));

    renderDetail();

    expect(await screen.findByText('EIP-7702')).toBeInTheDocument();
  });

  it('shows the shared dust-value floor with the exact wei on the title', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(makeTx({ value: '1', timestamp: '2024-01-01T00:00:00Z' })),
    );

    renderDetail();

    // 1 wei floors at <0.0001 (shared formatValue contract, no more
    // misleading 0.000000) while the title keeps the exact integer.
    expect(await screen.findByText('<0.0001 ETH')).toBeInTheDocument();
    expect(screen.getByTitle('1 wei')).toBeInTheDocument();
    expect(screen.queryByText('0.000000 ETH')).not.toBeInTheDocument();
  });

  it('falls back to the transactions list when the back button has no history to step into', async () => {
    // Fresh deep link (jsdom: no referrer, window.history.length === 1):
    // the back control lands on the chain's transactions list — the same
    // fallback rule the block detail page uses — not the old chain home.
    renderDetail();

    // Both the page header and the card share the "Transaction Details"
    // title — the back click is what matters below.
    expect((await screen.findAllByRole('heading', { name: 'Transaction Details' })).length).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: /Back to Explorer/ }));
    expect(await screen.findByTestId('tx-list')).toBeInTheDocument();
    expect(screen.queryByTestId('top-navigation')).not.toBeInTheDocument();
  });
});
