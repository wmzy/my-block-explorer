// Transaction-detail readability wave: the Token Transfers card renders the
// decoded ERC-20/721/1155 movements as From → To + human-readable amount
// (raw base units until metadata lands, formatted once it does) and links
// every token contract; the EIP-7702 card lists the authority → delegate
// pairs. The decoder itself is unit-tested in tokenTransferDecode.test.ts;
// this file pins the view contract the user actually sees.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';

import TransactionDetail from '@/views/Transactions/Detail';
import { useContractSource } from '@/services/contracts';
import { useTransactionByHash } from '@/services/chainRpc';
import { useTokenMetadata, type TokenMetadata } from '@/services/tokenMetadata';
import type { DecodedTokenTransfer } from '@/utils/tokenTransferDecode';

vi.mock('@/services/contracts', () => ({
  useContractSource: vi.fn(),
}));

vi.mock('@/services/chainRpc', () => ({
  useTransactionByHash: vi.fn(),
}));

// Metadata hook is stubbed per test; the fetch layer is unit-tested in
// tokenMetadata.test.ts, this file only pins what the card does with it.
vi.mock('@/services/tokenMetadata', () => ({
  useTokenMetadata: vi.fn(),
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
  POPULAR_CHAINS: [{ id: 1, name: 'Ethereum' }],
}));

const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const FROM = '0x1111111111111111111111111111111111111111';
const TO = '0x2222222222222222222222222222222222222222';
const TX_HASH = '0xtxhash0000000000000000000000000000000000000000000000000000000000';

const usdtTransfer: DecodedTokenTransfer = {
  kind: 'erc20',
  token: USDT,
  from: FROM,
  to: TO,
  value: '103870000', // 6 decimals → 103.87
};

const nftTransfer: DecodedTokenTransfer = {
  kind: 'erc721',
  token: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  from: FROM,
  to: TO,
  tokenId: '12345',
};

const erc1155Single: DecodedTokenTransfer = {
  kind: 'erc1155_single',
  token: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  from: FROM,
  to: TO,
  id: '5',
  amount: '3',
};

const erc1155Batch: DecodedTokenTransfer = {
  kind: 'erc1155_batch',
  token: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  from: FROM,
  to: TO,
  ids: ['5', '6'],
  amounts: ['3', '2'],
};

const makeTx = (overrides: Record<string, unknown> = {}) =>
  ({
    hash: TX_HASH,
    blockNumber: '18000001',
    transactionIndex: 5,
    fromAddress: FROM,
    toAddress: TO,
    value: '0',
    gasLimit: '50000',
    gasUsed: '30000',
    gasPrice: '20000000000',
    nonce: 42,
    type: 2,
    status: 1,
    inputData: '0x',
    logs: [],
    ...overrides,
  }) as never;

const hookResult = (data: unknown) =>
  ({ data, loading: false, error: undefined, refetch: vi.fn() }) as unknown as never;

const usdtMetadata = (): Map<string, TokenMetadata> =>
  new Map([[USDT.toLowerCase(), { symbol: 'USDT', decimals: 6 }]]);

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
  vi.mocked(useContractSource).mockReturnValue(hookResult({}));
});

describe('Token Transfers card', () => {
  it('renders From → To rows with human-readable amounts once metadata lands', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(makeTx({ tokenTransfers: [usdtTransfer] })),
    );
    vi.mocked(useTokenMetadata).mockReturnValue(usdtMetadata());

    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Token Transfers' })).toBeInTheDocument();
    // Human-readable ERC-20 amount: 103870000 base units at 6 decimals.
    expect(screen.getByText('103.8700 USDT')).toBeInTheDocument();
    // From/To link into the address view (the main card carries its own
    // From/To links with the same text — require at least one with the
    // transfer-row href); token link into the contract view.
    const fromLinks = screen.getAllByRole('link', { name: new RegExp(FROM.slice(0, 8)) });
    expect(fromLinks.some(link => link.getAttribute('href') === `/chain/1/address/${FROM}`)).toBe(true);
    expect(screen.getByRole('link', { name: new RegExp(USDT.slice(0, 8)) })).toHaveAttribute(
      'href',
      `/chain/1/contract/${USDT}`,
    );
  });

  it('shows raw base units until metadata lands, then never invents a symbol', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(makeTx({ tokenTransfers: [usdtTransfer] })),
    );
    vi.mocked(useTokenMetadata).mockReturnValue(undefined);

    renderDetail();

    expect(await screen.findByText('103870000 (raw units)')).toBeInTheDocument();
    expect(screen.queryByText('103.8700 USDT')).not.toBeInTheDocument();
  });

  it('renders ERC-721 tokenId and ERC-1155 id×amount rows', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(
        makeTx({ tokenTransfers: [nftTransfer, erc1155Single, erc1155Batch] }),
      ),
    );
    vi.mocked(useTokenMetadata).mockReturnValue(new Map());

    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Token Transfers' })).toBeInTheDocument();
    expect(screen.getByText('Token ID 12345')).toBeInTheDocument();
    expect(screen.getByText('ID 5 × 3')).toBeInTheDocument();
    expect(screen.getByText('ID 5 × 3 • ID 6 × 2')).toBeInTheDocument();
  });

  it('does not render the card when the transaction has no token transfers', async () => {
    vi.mocked(useTokenMetadata).mockReturnValue(undefined);

    renderDetail();

    // Wait for the page itself to render (the main card is always there),
    // then pin the card absence — and that the metadata hook was never
    // consulted without a transfer list.
    expect(await screen.findByText('Transaction Type')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Token Transfers' })).not.toBeInTheDocument();
    expect(useTokenMetadata).not.toHaveBeenCalled();
  });
});

describe('EIP-7702 Authorizations card', () => {
  const DELEGATE = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b';
  const AUTHORITY = '0x4D516eF6D95d80D66C9a79c8B67e296fe851C8Cd';

  it('lists authority → delegate pairs with view/contract links', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(
        makeTx({
          type: 4,
          authorizationList: [{ chainId: '1', address: DELEGATE, nonce: '7', authority: AUTHORITY }],
        }),
      ),
    );
    vi.mocked(useTokenMetadata).mockReturnValue(new Map());

    renderDetail();

    expect(await screen.findByRole('heading', { name: 'EIP-7702 Authorizations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: new RegExp(AUTHORITY.slice(0, 8)) })).toHaveAttribute(
      'href',
      `/chain/1/address/${AUTHORITY}`,
    );
    expect(screen.getByRole('link', { name: new RegExp(DELEGATE.slice(0, 8)) })).toHaveAttribute(
      'href',
      `/chain/1/contract/${DELEGATE}`,
    );
  });

  it('states an absent authority honestly instead of guessing it', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(
        makeTx({
          type: 4,
          authorizationList: [{ chainId: '1', address: DELEGATE, nonce: '7' }],
        }),
      ),
    );
    vi.mocked(useTokenMetadata).mockReturnValue(new Map());

    renderDetail();

    expect(await screen.findByRole('heading', { name: 'EIP-7702 Authorizations' })).toBeInTheDocument();
    expect(screen.getByText('Not reported by node')).toBeInTheDocument();
  });
});
