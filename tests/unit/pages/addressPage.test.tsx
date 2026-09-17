import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';
import AddressView from '@/views/Address';

// Mutable per-test data consumed by the service mocks below: the page test
// pins view behavior, so the services layer is replaced with settled
// results the cases can reshape.
const mocks = vi.hoisted(() => {
  const testAddress = '0x1234567890abcdef1234567890abcdef12345678';
  const mockTransactions = [
    {
      hash: '0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1',
      blockNumber: '18000001',
      fromAddress: testAddress,
      toAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      value: '1000000000000000000',
      status: 1,
      timestamp: '2024-01-01T00:00:00Z',
    },
    {
      hash: '0xdef789abc123def789abc123def789abc123def789abc123def789abc123def7',
      blockNumber: '18000000',
      fromAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      toAddress: testAddress,
      value: '500000000000000000',
      status: 1,
      timestamp: '2024-01-01T00:00:00Z',
    },
  ];
  // The `address` member is reshaped per case (contract vs EOA envelope) —
  // typed loosely so partial records assign cleanly.
  type AddressRecord = {
    isContract: boolean;
    contractName?: string;
    verificationStatus?: 'verified' | 'unverified' | 'partial';
    sourceCodeAvailable?: boolean;
  };
  // Hook results reshaped per case (the checksum-error tests swap in
  // error-bearing shapes); typed so Error assignments stay legal.
  type RealTimeResult = {
    data?: {
      balance: string;
      balanceWei: string;
      transactionCount: number;
      latestBlock: number;
    };
    loading: boolean;
    fetching: boolean;
    error?: Error;
  };
  const settledRealTime: RealTimeResult = {
    data: {
      balance: '1.5',
      balanceWei: '1500000000000000000',
      transactionCount: 42,
      latestBlock: 18000000,
    },
    loading: false,
    fetching: false,
    error: undefined,
  };
  const addressInfo: {
    chainId: number;
    chainName: string;
    address: AddressRecord;
    timestamp: string;
  } = {
    chainId: 1,
    chainName: 'Ethereum',
    address: {
      isContract: false,
    },
    timestamp: '2026-01-01T00:00:00Z',
  };
  // Reshaped per case: honesty fields (coverage/reason/method/window) are
  // optional — the view must tolerate their absence (pre-coverage caches).
  type AddressTxPageMock = {
    transactions: typeof mockTransactions;
    total: number;
    method?: string;
    coverage?: 'complete' | 'partial' | 'none';
    reason?: 'no-transactions' | 'zero-balance' | 'search-failed';
    searchWindowBlocks?: number;
  };
  const initialAddressTxPage: AddressTxPageMock = {
    transactions: mockTransactions,
    total: mockTransactions.length,
  };
  return {
    testAddress,
    mockTransactions,
    addressInfo,
    realTime: settledRealTime,
    addressTxError: undefined as Error | undefined,
    addressTransactions: initialAddressTxPage,
    // Plain function (vi is unavailable inside vi.hoisted); tests spy on it
    // to assert the retry affordance.
    txRefetch: () => undefined,
  };
});

vi.mock('../../../src/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">
      TopNav chain=
      {currentChainId}
    </div>
  ),
}));

vi.mock('../../../src/config/chains', () => ({
  getChainInfo: (chainId: number) => {
    if (chainId === 1) return { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } };
    return null;
  },
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : 'Unknown'),
  getChainSymbol: (chainId: number) => (chainId === 1 ? 'ETH' : 'UNKNOWN'),
}));

vi.mock('@/services/addresses', () => ({
  useAddressInfo: () => ({
    data: mocks.addressInfo,
    loading: false,
    fetching: false,
    error: undefined,
  }),
  useAddressTransactions: () => ({
    data: mocks.addressTransactions,
    loading: false,
    fetching: false,
    error: mocks.addressTxError,
    refetch: mocks.txRefetch,
  }),
}));

vi.mock('@/services/addressRealTime', () => ({
  useRealTimeAddressData: () => mocks.realTime,
  useContractCode: () => ({
    data: undefined,
    loading: false,
    fetching: false,
    error: undefined,
  }),
}));

vi.mock('@/utils/format', () => ({
  formatRelativeTime: () => '3 min ago',
}));

const routes = createRoutes([
  {
    path: '/chain/:chainId/address/:address',
    component: () => Promise.resolve(AddressView),
  },
]);

const renderPage = (path = `/chain/1/address/${mocks.testAddress}`) =>
  render(
    <MemoryRouter routes={routes} initialEntries={[path]}>
      <View />
    </MemoryRouter>,
  );

describe('Address view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addressInfo.address = {
      isContract: false,
      contractName: undefined,
      verificationStatus: undefined,
      sourceCodeAvailable: false,
    };
    mocks.addressTransactions = {
      transactions: mocks.mockTransactions,
      total: mocks.mockTransactions.length,
    };
    mocks.realTime = {
      data: {
        balance: '1.5',
        balanceWei: '1500000000000000000',
        transactionCount: 42,
        latestBlock: 18000000,
      },
      loading: false,
      fetching: false,
      error: undefined,
    };
    mocks.addressTxError = undefined;
  });

  it('renders TopNavigation', async () => {
    renderPage();
    expect(await screen.findByTestId('top-navigation')).toBeInTheDocument();
  });

  it('displays address details header', async () => {
    renderPage();
    expect(await screen.findByText('Address Details')).toBeInTheDocument();
    expect(screen.getByText(/Ethereum/)).toBeInTheDocument();
  });

  it('shows address overview with balance', async () => {
    renderPage();

    await screen.findByText('Overview');
    expect(screen.getByText(mocks.testAddress)).toBeInTheDocument();
    expect(screen.getByText(/1\.5 ETH/)).toBeInTheDocument();
  });

  it('shows transaction count from real-time data', async () => {
    renderPage();

    await screen.findByText('Overview');
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders Recent Transactions section', async () => {
    renderPage();

    expect(await screen.findByText('Recent Transactions')).toBeInTheDocument();
  });

  it('displays transaction direction badges', async () => {
    renderPage();

    await screen.findByText('Recent Transactions');
    const outBadges = screen.getAllByText('OUT');
    const inBadges = screen.getAllByText('IN');
    expect(outBadges.length).toBeGreaterThan(0);
    expect(inBadges.length).toBeGreaterThan(0);
  });

  it('paginates the transaction table', async () => {
    renderPage();

    expect(await screen.findByText('Page 1 of 1')).toBeInTheDocument();
  });

  it('links to the contract view for contract addresses', async () => {
    mocks.addressInfo.address = { isContract: true };

    renderPage();

    const link = (await screen.findByText('View Contract Details →')).closest('a');
    expect(link?.getAttribute('href')).toBe(`/chain/1/contract/${mocks.testAddress}`);
  });

  it('warns about an unknown data source instead of a trusted empty state when coverage is missing', async () => {
    // Pre-coverage cached payload: no coverage/method tags at all.
    mocks.addressTransactions = { transactions: [], total: 0 };

    renderPage();

    expect(
      await screen.findByText(/Transaction data source unknown/),
    ).toBeInTheDocument();
    expect(screen.getByText(/history may be incomplete/)).toBeInTheDocument();
    expect(screen.getByText(/Verify on an external explorer/)).toBeInTheDocument();
    // External escape hatch mirrors the partial banner's link row.
    expect(screen.getAllByText('Routescan').length).toBe(2);
    expect(screen.queryByText('No transactions found')).not.toBeInTheDocument();
  });

  it('shows the partial-history banner above the table for heuristic coverage', async () => {
    mocks.addressTransactions = {
      transactions: mocks.mockTransactions,
      total: 42,
      method: 'binary-search',
      coverage: 'partial',
      searchWindowBlocks: 600_000,
    };

    renderPage();

    expect(
      await screen.findByText(/Partial history - transactions are discovered heuristically/),
    ).toBeInTheDocument();
    expect(screen.getByText(/within the last 600,000 blocks/)).toBeInTheDocument();
    // External escape hatch: the banner adds a link row beyond the Overview
    // card's (Routescan appears in both).
    const routescanLinks = screen.getAllByText('Routescan');
    expect(routescanLinks.length).toBe(2);
  });

  it('shows the honest zero-balance banner instead of a bare empty list', async () => {
    mocks.addressTransactions = {
      transactions: [],
      total: 42,
      method: 'binary-search-skipped',
      coverage: 'none',
      reason: 'zero-balance',
    };

    renderPage();

    expect(
      await screen.findByText(
        /This address has 42 transactions but holds no native-token balance/,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Routescan').length).toBe(2);
    expect(screen.queryByText('No transactions found')).not.toBeInTheDocument();
  });

  it('shows the search-failed banner with a retry affordance, never an empty result', async () => {
    mocks.addressTransactions = {
      transactions: [],
      total: 0,
      method: 'fallback',
      coverage: 'none',
      reason: 'search-failed',
    };
    const refetchSpy = vi.spyOn(mocks, 'txRefetch');

    renderPage();

    expect(
      await screen.findByText(/Transaction search failed \(timeout\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/this is NOT an empty result/)).toBeInTheDocument();
    expect(screen.queryByText('No transactions found')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry search' }));
    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the plain empty state for complete coverage', async () => {
    mocks.addressTransactions = {
      transactions: [],
      total: 0,
      method: 'binary-search',
      coverage: 'complete',
      reason: 'no-transactions',
    };

    renderPage();

    expect(await screen.findByText('No transactions found')).toBeInTheDocument();
    expect(screen.queryByText(/Partial history/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Transaction data source unknown/)).not.toBeInTheDocument();
  });

  it('shows unsupported chain error for invalid chain', async () => {
    renderPage(`/chain/999/address/${mocks.testAddress}`);

    expect(await screen.findByText(/Unsupported chain ID/)).toBeInTheDocument();
  });

  it('shows checksum guidance instead of the raw 400 for a bad-checksum address', async () => {
    // Mixed-case bad checksum: the server validation (getValidatedAddress)
    // rejects with HTTP 400 'Invalid address'.
    mocks.realTime = {
      data: undefined,
      loading: false,
      fetching: false,
      error: new Error('Invalid address'),
    };

    renderPage();

    expect(
      await screen.findByText(/This address has an invalid checksum/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Try the all-lowercase form/)).toBeInTheDocument();
    expect(screen.getByText('Original error: Invalid address')).toBeInTheDocument();
    expect(screen.queryByText('Error: Invalid address')).not.toBeInTheDocument();
  });

  it('shows checksum guidance in the transactions card when the tx search rejects the address', async () => {
    mocks.addressTxError = new Error('Invalid address');

    renderPage();

    expect(await screen.findByText(/This address has an invalid checksum/)).toBeInTheDocument();
    expect(screen.getByText('Original error: Invalid address')).toBeInTheDocument();
    expect(screen.queryByText('No transactions found')).not.toBeInTheDocument();
  });

  it('keeps the plain error banner for unrelated failures', async () => {
    mocks.realTime = {
      data: undefined,
      loading: false,
      fetching: false,
      error: new Error('RPC timeout'),
    };

    renderPage();

    expect(await screen.findByText('Error: RPC timeout')).toBeInTheDocument();
    expect(screen.queryByText(/invalid checksum/i)).not.toBeInTheDocument();
  });
});
