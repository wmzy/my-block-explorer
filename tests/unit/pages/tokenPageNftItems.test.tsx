// Page-level tests for the Token view's NFT surfaces: the Items
// (discovered) grid appears exactly when the scan rows evidence NFT
// items on a standard-unknown token (and never for a proven ERC-20 —
// the non-NFT page stays free of the section), and the top-holders list
// renders holder addresses through EnsInline (a resolved ENS name
// replaces the address text). Services are mocked to settled results;
// the pure derivation itself has its own focused test file.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';

import TokenPage from '@/views/Token';

const mocks = vi.hoisted(() => {
  const testAddress = '0x1234567890abcdef1234567890abcdef12345678';
  // Per-case mutable fixtures need widened property types (undefined
  // resets, per-key reshapes) — via annotated variables, not assertions
  // (this config flags the equivalent `as` as unnecessary).
  const initialContractCode: string | undefined = '0x600a';
  const initialEnsNames: Record<string, string | null> = {};
  // Probe-reads shape: per case the settle is NFT-ish (name/symbol
  // responded, decimals reverts — the classic unknown-standard,
  // probably ERC-721) or proven ERC-20 (decimals AND totalSupply).
  type ProbeReads = {
    name: string | null;
    symbol: string | null;
    decimals: number | null;
    totalSupply: bigint | null;
  };
  const nftishReads: ProbeReads = {
    name: 'Wrapped Punks',
    symbol: 'WPUNK',
    decimals: null,
    totalSupply: null,
  };
  const erc20Reads: ProbeReads = {
    name: 'DAI Stablecoin',
    symbol: 'DAI',
    decimals: 18,
    totalSupply: 10n ** 24n,
  };
  return {
    testAddress,
    nftishReads,
    erc20Reads,
    reads: nftishReads,
    contractCode: initialContractCode,
    // Token-mode page-1 rows the holders/items feed consumes.
    transfers: [] as Record<string, unknown>[],
    transfersLoading: false,
    ensNames: initialEnsNames,
    nftMetadata: new Map<
      string,
      | { status: 'ok'; name: string | null; image: string | null; description: string | null }
      | { status: 'none' }
      | { status: 'unavailable' }
    >(),
  };
});

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">TopNav chain={currentChainId}</div>
  ),
}));

vi.mock('@/config/chains', () => ({
  getChainInfo: (chainId: number) =>
    chainId === 1 ? { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } } : null,
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : 'Unknown'),
  getChainSymbol: (chainId: number) => (chainId === 1 ? 'ETH' : 'UNKNOWN'),
  isChainSupported: (chainId: number) => chainId === 1,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
  POPULAR_CHAINS: [{ id: 1, name: 'Ethereum' }],
}));

vi.mock('@/services/addressRealTime', () => ({
  useContractCode: () => ({
    data: mocks.contractCode,
    loading: false,
    fetching: false,
    error: undefined,
  }),
}));

vi.mock('@/services/tokenMetadata', () => ({
  useTokenOverviewProbe: () => ({ reads: mocks.reads, settled: true }),
}));

vi.mock('@/services/prices', () => ({
  useTokenUsdPrice: () => null,
  usePriceHistory: () => undefined,
  tokenAmountToUsd: () => null,
}));

vi.mock('@/services/tokenTransfers', () => ({
  useTokenTransfers: () => ({
    data: {
      transfers: mocks.transfers,
      nextCursor: null,
      coverage: 'complete' as const,
      windowBlocks: 100_000,
      mode: 'token' as const,
    },
    loading: mocks.transfersLoading,
    fetching: false,
    error: undefined,
    refetch: () => undefined,
  }),
  requestTokenTransfersRefresh: () => undefined,
}));

vi.mock('@/views/Address/TokenTransfers', () => ({
  TRANSFER_LIMIT: 25,
  default: () => <div data-testid="token-transfers-stub" />,
}));

vi.mock('@/services/contracts', () => ({
  useContractSource: () => ({
    data: undefined,
    loading: false,
    fetching: false,
    error: undefined,
  }),
}));

vi.mock('@/services/tokenDirectory', () => ({
  recordViewedToken: () => undefined,
}));

vi.mock('@/services/ens', () => ({
  useEnsName: (address: string | undefined) => ({
    data: address !== undefined ? (mocks.ensNames[address] ?? null) : null,
    loading: false,
  }),
}));

// Partial: the key builder stays real (NftGrid keys its lookups through
// it); the network-touching halves are stubbed to settled fixtures.
vi.mock('@/services/nftMetadata', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/nftMetadata')>();
  return {
    ...actual,
    useNftMetadata: () => mocks.nftMetadata,
    fetchNftMetadataBatch: vi.fn(async () => new Map()),
  };
});

const routes = createRoutes([
  {
    path: '/chain/:chainId/token/:address',
    component: () => Promise.resolve(TokenPage),
  },
]);

const renderPage = (path = `/chain/1/token/${mocks.testAddress}`) =>
  render(
    <MemoryRouter routes={routes} initialEntries={[path]}>
      <View />
    </MemoryRouter>,
  );

// Token-mode Transfer row builders (the shapes the backend hands the
// page — see services/TokenTransferService's log mapping).
const erc721Row = (tokenId: string, blockNumber: number) => ({
  txHash: `0x${'a'.repeat(64)}`,
  blockNumber,
  logIndex: 0,
  token: mocks.testAddress.toLowerCase(),
  standard: 'erc20-or-erc721',
  logStandard: 'erc721',
  from: '0x0000000000000000000000000000000000000000',
  to: '0x1111111111111111111111111111111111111111',
  value: tokenId,
  direction: 'none',
});

const erc20Row = (value: string, from: string, to: string) => ({
  txHash: `0x${'b'.repeat(64)}`,
  blockNumber: 18_000_000,
  logIndex: 1,
  token: mocks.testAddress.toLowerCase(),
  standard: 'erc20-or-erc721',
  logStandard: 'erc20',
  from,
  to,
  value,
  direction: 'none',
});

beforeEach(() => {
  mocks.reads = mocks.nftishReads;
  mocks.contractCode = '0x600a';
  mocks.transfers = [];
  mocks.transfersLoading = false;
  mocks.ensNames = {};
  mocks.nftMetadata = new Map();
});

describe('TokenPage Items (discovered) section', () => {
  it('renders the grid with its caveat for an NFT-ish token with 721 rows', async () => {
    mocks.transfers = [erc721Row('7', 18_000_002), erc721Row('3', 18_000_001)];
    renderPage();

    expect(await screen.findByText('Items (discovered)')).toBeInTheDocument();
    expect(screen.getByTestId('nft-items-caveat')).toHaveTextContent(
      'Showing up to 24 items discovered from scanned transfers — not the full collection supply.',
    );
    const tiles = screen.getAllByTestId('nft-item-tile');
    expect(tiles.map(tile => tile.dataset.tokenId)).toEqual(['7', '3']);
  });

  it('stays absent for a proven ERC-20 even when the rows are 721-shaped', async () => {
    mocks.reads = mocks.erc20Reads;
    // A pathological emitter: 4-topic rows on a contract whose probes
    // proved ERC-20 — the section must skip entirely.
    mocks.transfers = [erc721Row('7', 18_000_002)];
    renderPage();

    expect(await screen.findByText('Token Overview')).toBeInTheDocument();
    expect(screen.queryByText('Items (discovered)')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nft-item-tile')).not.toBeInTheDocument();
  });

  it('stays absent for a standard-unknown token with no NFT-shaped rows', async () => {
    mocks.transfers = [
      erc20Row('100', '0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222'),
    ];
    renderPage();

    expect(await screen.findByText('Token Overview')).toBeInTheDocument();
    expect(screen.queryByText('Items (discovered)')).not.toBeInTheDocument();
  });

  it('stays absent while the scan is still in flight without rows', async () => {
    mocks.transfersLoading = true;
    renderPage();

    expect(await screen.findByText('Token Overview')).toBeInTheDocument();
    expect(screen.queryByText('Items (discovered)')).not.toBeInTheDocument();
  });
});

describe('TokenPage holders ENS', () => {
  const holderA = '0x1111111111111111111111111111111111111111';
  const holderB = '0x2222222222222222222222222222222222222222';

  beforeEach(() => {
    mocks.reads = mocks.erc20Reads;
    // ERC-20 mints to two holders — the holders card ranks both.
    mocks.transfers = [
      erc20Row('100', '0x0000000000000000000000000000000000000000', holderA),
      erc20Row('50', '0x0000000000000000000000000000000000000000', holderB),
    ];
  });

  it('renders resolved ENS names in place of the holder addresses', async () => {
    mocks.ensNames = { [holderA]: 'alice.eth' };
    renderPage();

    expect(await screen.findByText('alice.eth')).toBeInTheDocument();
    // The unnamed holder keeps its short-address fallback.
    expect(screen.getByText('0x222222...222222')).toBeInTheDocument();
  });

  it('renders short addresses for every holder when no names resolve', async () => {
    renderPage();

    expect(await screen.findByText('0x111111...111111')).toBeInTheDocument();
    expect(screen.getByText('0x222222...222222')).toBeInTheDocument();
    expect(screen.queryByText(/\.eth$/)).not.toBeInTheDocument();
  });
});
