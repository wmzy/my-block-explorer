// Transaction-detail signature enrichment: the openchain-resolved names
// for an undecoded function selector / event topic0 render next to the raw
// hex with a provenance chip, multiple candidates collapse to the most
// popular plus "(+N more)", and unavailable/absent outcomes leave the raw
// fallback exactly as before. The lookup hook is mocked to settled
// outcomes — the fetch/batching behavior lives in signaturesFrontend.test.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import { encodeFunctionData, toEventSelector, type Abi, type Hex } from 'viem';
import '@testing-library/jest-dom';

import TransactionDetail from '@/views/Transactions/Detail';
import { useContractSource } from '@/services/contracts';
import { useTransactionByHash } from '@/services/chainRpc';
import { useSignatures, type SignatureOutcome } from '@/services/signatures';

vi.mock('@/services/contracts', () => ({
  useContractSource: vi.fn(),
}));

vi.mock('@/services/chainRpc', () => ({
  useTransactionByHash: vi.fn(),
}));

vi.mock('@/services/signatures', () => ({
  useSignatures: vi.fn(),
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
  CopyableHash: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock('@/config/chains', () => ({
  getChainName: () => 'Ethereum',
  getChainInfo: (chainId: number) => (chainId === 1 ? { id: 1, name: 'Ethereum' } : null),
  getChainSymbol: () => 'ETH',
  isChainSupported: (chainId: number) => chainId === 1,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
  POPULAR_CHAINS: [
    { id: 1, name: 'Ethereum' },
    { id: 137, name: 'Polygon' },
  ],
}));

const TOKEN = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const SENDER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
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
]);
const parsedAbi = JSON.parse(abiJson) as Abi;

const AMOUNT = 1000000n;
const inputData = encodeFunctionData({
  abi: parsedAbi,
  functionName: 'transfer',
  args: [RECIPIENT, AMOUNT],
});
const fnSelector = inputData.slice(0, 10);

const transferTopic0 = toEventSelector('Transfer(address,address,uint256)');
const addressTopic = (addr: string): Hex => `0x${addr.slice(2).toLowerCase().padStart(64, '0')}`;
const transferLog = {
  address: TOKEN,
  topics: [transferTopic0, addressTopic(SENDER), addressTopic(RECIPIENT)],
  data: `0x${AMOUNT.toString(16).padStart(64, '0')}`,
  logIndex: '0',
};

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

const mockOutcomes = (outcomes: Record<string, SignatureOutcome>) =>
  vi.mocked(useSignatures).mockReturnValue(outcomes);

const TxListStub = () => <div data-testid="tx-list" />;

function renderDetail() {
  const routes = createRoutes([
    { path: '/chain/:chainId/tx/:txHash', component: () => TransactionDetail },
    { path: '/chain/:chainId/transactions', component: () => TxListStub },
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
  // Unverified target: 404 error → no ABI → the raw fallbacks run.
  vi.mocked(useContractSource).mockReturnValue(
    hookResult(undefined, new Error('Request failed with status code 404')),
  );
  mockOutcomes({});
});

describe('TransactionDetail - openchain signature enrichment', () => {
  it('renders resolved names for an undecoded selector and topic0 with provenance chips', async () => {
    mockOutcomes({
      [fnSelector]: {
        kind: 'function',
        signatures: ['transfer(address,uint256)', 'foo(bytes32)'],
        source: 'openchain',
      },
      [transferTopic0.toLowerCase()]: {
        kind: 'event',
        signatures: ['Transfer(address,address,uint256)'],
        source: 'openchain',
      },
    });
    vi.mocked(useTransactionByHash).mockReturnValue(hookResult(makeTx({ logs: [transferLog] })));

    renderDetail();

    // Method row: raw selector kept, resolved name beside it, "(+N more)"
    // for the second candidate, chip marking the openchain provenance.
    expect(await screen.findByRole('heading', { name: 'Function Call' })).toBeInTheDocument();
    expect(screen.getByText(fnSelector)).toBeInTheDocument();
    expect(screen.getByText('transfer(address,uint256)')).toBeInTheDocument();
    expect(screen.getByText('(+1 more)')).toBeInTheDocument();

    // Event log: resolved event signature leads the raw topics block and
    // the topic0 openchain link stays available.
    expect(await screen.findByRole('heading', { name: 'Event Logs' })).toBeInTheDocument();
    expect(screen.getByText('Transfer(address,address,uint256)')).toBeInTheDocument();
    const topic0Link = screen.getByRole('link', { name: new RegExp(transferTopic0.slice(2)) });
    expect(topic0Link).toHaveAttribute(
      'href',
      `https://openchain.xyz/signatures?query=${transferTopic0}`,
    );

    // Both surfaces carry the chip.
    expect(screen.getAllByText('openchain')).toHaveLength(2);
    // No error UI anywhere: the enrichment never becomes a failure state.
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
  });

  it('leaves the raw rendering untouched when the lookup is unavailable or empty', async () => {
    mockOutcomes({
      [fnSelector]: { unavailable: true },
      [transferTopic0.toLowerCase()]: { kind: 'event', signatures: [], notFound: true },
    });
    vi.mocked(useTransactionByHash).mockReturnValue(hookResult(makeTx({ logs: [transferLog] })));

    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Function Call' })).toBeInTheDocument();
    expect(screen.getByText(fnSelector)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Event Logs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: new RegExp(transferTopic0.slice(2)) }));
    // No resolved name, no "(+N more)", no chip — exactly the pre-feature UI.
    expect(screen.queryByText('transfer(address,uint256)')).not.toBeInTheDocument();
    expect(screen.queryByText('Transfer(address,address,uint256)')).not.toBeInTheDocument();
    expect(screen.queryByText('openchain')).not.toBeInTheDocument();
    expect(screen.queryByText(/\(\+\d+ more\)/)).not.toBeInTheDocument();
  });

  it('does not decorate the ABI-decoded path with database names', async () => {
    // Verified target: both the function call and (per the shared decode
    // helper) an ABI-matching log decode from the contract ABI.
    vi.mocked(useContractSource).mockReturnValue(
      hookResult({
        contractSource: {
          abi: JSON.stringify([
            ...parsedAbi,
            {
              type: 'event',
              name: 'Transfer',
              inputs: [
                { name: 'from', type: 'address', indexed: true },
                { name: 'to', type: 'address', indexed: true },
                { name: 'value', type: 'uint256', indexed: false },
              ],
            },
          ]),
        },
      }),
    );
    vi.mocked(useTransactionByHash).mockReturnValue(hookResult(makeTx({ logs: [transferLog] })));
    mockOutcomes({
      [fnSelector]: {
        kind: 'function',
        signatures: ['transfer(address,uint256)'],
        source: 'openchain',
      },
    });

    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Function Call' })).toBeInTheDocument();
    expect(screen.getByText(`transfer(${RECIPIENT}, 1000000)`)).toBeInTheDocument();
    // The ABI-decoded method row carries no database chip.
    expect(screen.queryByText('openchain')).not.toBeInTheDocument();
    expect(screen.queryByText('(+1 more)')).not.toBeInTheDocument();
  });
});
