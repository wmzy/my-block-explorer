// The token page's directory-recorder wiring (the ONE effect added to
// views/Token): rendering a settled token page must land the token in
// this browser's viewed-token store (checksummed, with the resolved
// symbol/name hints), while a settled not-a-token contract must perform
// NO write — the directory must not collect every address someone
// deep-links as a "token". The real services/tokenDirectory store runs
// against the real jsdom localStorage; everything else the page needs is
// mocked with settled results (tokenPage.test.tsx's compact mock set).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import { getAddress } from 'viem';
import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import TokenPage from '@/views/Token';
import { readViewedTokens } from '@/services/tokenDirectory';

const TEST_ADDRESS = `0x${'a1'.repeat(20)}`;
const TEST_CHECKSUMMED = getAddress(TEST_ADDRESS);

type RecorderMocks = {
  contractCode: string | undefined;
  reads:
    | { name: string | null; symbol: string | null; decimals: number | null; totalSupply: bigint | null }
    | undefined;
  settled: boolean;
};

const mocks = vi.hoisted<RecorderMocks>(() => ({
  contractCode: '0x608060405234801561000f57600080fd5b50',
  reads: {
    name: 'Mock Token',
    symbol: 'MCK',
    decimals: 18,
    totalSupply: 1_000n,
  },
  settled: true,
}));

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
  useTokenOverviewProbe: (
    _chainId: number,
    _token: string,
    enabled: boolean,
  ) =>
    enabled
      ? { reads: mocks.reads, settled: mocks.settled }
      : { reads: undefined, settled: false },
  useTokenOverview: (
    _chainId: number,
    _token: string,
    enabled: boolean,
  ) => {
    if (!enabled) return undefined;
    return mocks.reads;
  },
}));

vi.mock('@/services/tokenTransfers', () => ({
  useTokenTransfers: () => ({
    data: undefined,
    loading: true,
    fetching: false,
    error: undefined,
    refetch: () => undefined,
  }),
  requestTokenTransfersRefresh: () => undefined,
}));

vi.mock('@/services/contracts', () => ({
  useContractSource: () => ({
    data: {
      found: true,
      contractSource: { verificationStatus: 'unverified', abi: '[]' },
    },
    loading: false,
    fetching: false,
    error: undefined,
    refetch: () => undefined,
  }),
}));

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(async () => ({
    readContract: async () => 'MCK',
  })),
}));

// Prices settle unavailable without touching the network: the recorder
// must not depend on DefiLlama answering.
vi.mock('@/services/prices', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/prices')>();
  return {
    ...actual,
    useTokenUsdPrice: () => null,
    usePriceHistory: () => undefined,
  };
});

vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ variant = 'default', children }: { variant?: string; children: ReactNode }) => (
    <span data-variant={variant}>{children}</span>
  ),
}));

const routes = createRoutes([
  {
    path: '/chain/:chainId/token/:address',
    component: () => Promise.resolve(TokenPage),
  },
]);

const renderPage = (path = `/chain/1/token/${TEST_ADDRESS}`) =>
  render(
    <MemoryRouter routes={routes} initialEntries={[path]}>
      <View />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.contractCode = '0x608060405234801561000f57600080fd5b50';
  mocks.reads = {
    name: 'Mock Token',
    symbol: 'MCK',
    decimals: 18,
    totalSupply: 1_000n,
  };
  mocks.settled = true;
});

describe('Token page — viewed-token recorder wiring', () => {
  it('records the opened token checksummed with its resolved hints', async () => {
    renderPage();

    // The page proper (overview card) proves the settle landed…
    expect(await screen.findByText('Token Overview')).toBeInTheDocument();

    // …and the effect wrote the visit to this browser's store.
    await waitFor(() => {
      expect(readViewedTokens(1)).toHaveLength(1);
    });
    const [entry] = readViewedTokens(1);
    expect(entry.address).toBe(TEST_CHECKSUMMED);
    expect(entry.symbol).toBe('MCK');
    expect(entry.name).toBe('Mock Token');
    expect(typeof entry.firstSeen).toBe('string');
  });

  it('performs no write for a settled not-a-token contract', async () => {
    // A plain contract: probes settled but nothing responded.
    mocks.reads = { name: null, symbol: null, decimals: null, totalSupply: null };

    renderPage();

    expect(await screen.findByText(/not a token/i)).toBeInTheDocument();
    // Effects flush with the assertion loop — still nothing recorded.
    await waitFor(() => {
      expect(screen.getByText(/not a token/i)).toBeInTheDocument();
    });
    expect(readViewedTokens(1)).toEqual([]);
    expect(localStorage.getItem('be:viewedTokens:1')).toBeNull();
  });
});
