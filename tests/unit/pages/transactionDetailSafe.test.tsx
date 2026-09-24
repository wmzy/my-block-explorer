// Transaction-detail Safe-multisig decode: a calldata payload matching the
// execTransaction selector+shape renders the structured card — inner-call
// target link, forwarded value, operation badge (DELEGATECALL present with
// its own tone), inner method selector resolved through the page's
// existing openchain lookup, and the honest ≈-signature-blob summary —
// while the card copy states the selector-based-detection limit. A plain
// transfer fixture renders no card. Fixtures are encoded with viem's
// encodeFunctionData; the lookup hook is mocked to settled outcomes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import { encodeFunctionData, parseAbi, toFunctionSelector, type Abi } from 'viem';
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
  isChainSupported: (chainId: number) => chainId === 1,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
  POPULAR_CHAINS: [
    { id: 1, name: 'Ethereum' },
    { id: 137, name: 'Polygon' },
  ],
}));

const SAFE = '0x416f52dbe63057bb993f0f0e3c7f5a9d2b1c8d4e';
const SENDER = '0x1111111111111111111111111111111111111111';
const INNER_TARGET = '0x2222222222222222222222222222222222222222';
const TX_HASH = '0xtxhash0000000000000000000000000000000000000000000000000000000000';

const safeExecAbi = parseAbi([
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, bytes signatures) payable returns (bool success)',
]);

const SIGNATURES: `0x${string}` = `0x${'ab'.repeat(130)}`;

const INNER_VALUE = 1_500_000_000_000_000_000n;

// ERC-20 transfer as the inner call — a real selector for the openchain
// resolution path to name.
const innerTransferData: `0x${string}` = encodeFunctionData({
  abi: parseAbi(['function transfer(address to, uint256 amount) returns (bool)']),
  args: [INNER_TARGET, 1_000_000n],
});
const innerSelector = innerTransferData.slice(0, 10).toLowerCase();

const encodeExec = (operation: 0 | 1): string =>
  encodeFunctionData({
    abi: safeExecAbi,
    args: [
      INNER_TARGET,
      INNER_VALUE,
      innerTransferData,
      operation,
      0n,
      0n,
      0n,
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      SIGNATURES,
    ],
  });

// The ABI the Safe card must NOT rely on — belongs to the Safe itself and
// has no transfer(), pinning that the inner name is selector-based.
const safeSourceResponse = {
  contractSource: {
    chainId: 1,
    address: SAFE,
    name: 'GnosisSafe',
    abi: JSON.stringify(safeExecAbi satisfies Abi),
    verificationStatus: 'verified',
  },
};

const makeTx = (overrides: Record<string, unknown> = {}) =>
  ({
    hash: TX_HASH,
    blockNumber: '18000001',
    transactionIndex: 5,
    fromAddress: SENDER,
    toAddress: SAFE,
    value: '0',
    gasLimit: '50000',
    gasUsed: '30000',
    gasPrice: '20000000000',
    nonce: 42,
    type: 2,
    status: 1,
    inputData: encodeExec(0),
    logs: [],
    ...overrides,
  }) as never;

const hookResult = (data: unknown, error?: unknown) =>
  ({ data, loading: false, error, refetch: vi.fn() }) as unknown as never;

const resolvedTransfer: SignatureOutcome = {
  kind: 'function',
  signatures: ['transfer(address,uint256)'],
  source: 'openchain',
};

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
  vi.mocked(useContractSource).mockReturnValue(hookResult(safeSourceResponse));
  vi.mocked(useSignatures).mockReturnValue({});
});

describe('TransactionDetail - Safe-style multisig decode', () => {
  it('renders the execTransaction card with inner-call link, honest title and caveat copy', async () => {
    renderDetail();

    expect(
      await screen.findByRole('heading', { name: 'Safe-style Multisig (execTransaction)' }),
    ).toBeInTheDocument();
    // The honesty line: selector-based detection, not a Safe verification.
    expect(screen.getByText(/does not verify the target contract is a Gnosis Safe/)).toBeInTheDocument();
    expect(screen.getByText(/0x6a761202 calldata selector/)).toBeInTheDocument();

    // Inner call target links into the address view.
    const targetLink = screen.getByRole('link', { name: INNER_TARGET });
    expect(targetLink).toHaveAttribute('href', `/chain/1/address/${INNER_TARGET}`);
  });

  it('shows the forwarded value, CALL badge, inner selector and signature-blob summary', async () => {
    vi.mocked(useSignatures).mockReturnValue({ [innerSelector]: resolvedTransfer });

    renderDetail();

    expect(
      await screen.findByRole('heading', { name: 'Safe-style Multisig (execTransaction)' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1.5000 ETH')).toBeInTheDocument();
    expect(screen.getByTitle(`${INNER_VALUE} wei`)).toBeInTheDocument();
    expect(screen.getByText('CALL')).toBeInTheDocument();

    // Inner method: raw selector plus the openchain-resolved name with its
    // provenance chip — the same reuse path the function-call card uses.
    expect(screen.getByText(innerSelector)).toBeInTheDocument();
    expect(screen.getByText('transfer(address,uint256)')).toBeInTheDocument();
    expect(screen.getByText('openchain')).toBeInTheDocument();

    // Signature blob summary: ≈2 from 130 bytes, full blob on hover.
    expect(screen.getByText('≈2 signatures (130 bytes)')).toBeInTheDocument();
    expect(screen.getByTitle(SIGNATURES)).toBeInTheDocument();
  });

  it('feeds the inner selector into the page openchain lookup batch', async () => {
    renderDetail();

    await screen.findByRole('heading', { name: 'Safe-style Multisig (execTransaction)' });
    expect(useSignatures).toHaveBeenCalledWith(expect.arrayContaining([innerSelector]));
  });

  it('renders the DELEGATECALL operation for a delegate inner call', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(makeTx({ inputData: encodeExec(1) })),
    );
    vi.mocked(useSignatures).mockReturnValue({ [innerSelector]: resolvedTransfer });

    renderDetail();

    expect(
      await screen.findByRole('heading', { name: 'Safe-style Multisig (execTransaction)' }),
    ).toBeInTheDocument();
    expect(screen.getByText('DELEGATECALL')).toBeInTheDocument();
    expect(screen.queryByText('CALL')).not.toBeInTheDocument();
  });

  it('renders no Safe card for a plain native transfer', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(makeTx({ inputData: '0x', value: '1000000000000000000' })),
    );

    renderDetail();

    // The page settles on its normal transfer shape first.
    expect(await screen.findByText('1.0000 ETH')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Safe-style Multisig (execTransaction)' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/0x6a761202 calldata selector/)).not.toBeInTheDocument();
  });

  it('renders no Safe card for non-execTransaction contract calldata', async () => {
    // Same selector length, different function: the gate must hold.
    const erc20Call = encodeFunctionData({
      abi: parseAbi(['function approve(address spender, uint256 amount) returns (bool)']),
      args: [INNER_TARGET, 1n],
    });
    expect(erc20Call.slice(0, 10)).not.toBe('0x6a761202');
    vi.mocked(useTransactionByHash).mockReturnValue(hookResult(makeTx({ inputData: erc20Call })));

    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Function Call' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Safe-style Multisig (execTransaction)' }),
    ).not.toBeInTheDocument();
  });

  it('states the plain-transfer inner method when the Safe call forwards no data', async () => {
    const plainInner = encodeFunctionData({
      abi: safeExecAbi,
      args: [
        INNER_TARGET,
        INNER_VALUE,
        '0x',
        0,
        0n,
        0n,
        0n,
        '0x0000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000',
        SIGNATURES,
      ],
    });
    vi.mocked(useTransactionByHash).mockReturnValue(hookResult(makeTx({ inputData: plainInner })));

    renderDetail();

    expect(
      await screen.findByRole('heading', { name: 'Safe-style Multisig (execTransaction)' }),
    ).toBeInTheDocument();
    expect(screen.getByText('None (native transfer)')).toBeInTheDocument();
  });
});

// The inner selector fixture pinned against viem's own derivation.
describe('fixture sanity', () => {
  it('uses the canonical ERC-20 transfer selector', () => {
    expect(innerSelector).toBe(toFunctionSelector('transfer(address,uint256)'));
  });
});
