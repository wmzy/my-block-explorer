// Transaction detail page tests: the view under a minimal native-router
// harness with services and network-adjacent children mocked. Covers the
// four enrichment surfaces (function call, event logs, revert reason,
// created contract) plus the wrong-chain friendly error — real txDecode
// and viem codecs are exercised against realistic ABI-encoded fixtures.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
const addressTopic = (addr: string): Hex =>
  `0x${addr.slice(2).toLowerCase().padStart(64, '0')}`;
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

function renderDetail() {
  const routes = createRoutes([
    { path: '/chain/:chainId/tx/:txHash', component: () => TransactionDetail },
  ]);
  return render(
    <MemoryRouter routes={routes} initialEntries={[`/chain/1/tx/${TX_HASH}`]}>
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

  it('shows a friendly cross-chain hint for a wrong-chain not-found transaction', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(
        undefined,
        {
          name: 'TransactionNotFoundError',
          message: `Transaction with hash "${TX_HASH}" could not be found.`,
        },
      ),
    );

    renderDetail();

    expect(
      await screen.findByText(
        'Transaction not found on Ethereum. It may exist on another network or be pending.',
      ),
    ).toBeInTheDocument();
    const searchLink = screen.getByRole('link', { name: 'search across chains' });
    expect(searchLink).toHaveAttribute('href', '/search');
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
});
