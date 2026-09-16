import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  return {
    testAddress,
    mockTransactions,
    addressInfo,
    addressTransactions: {
      transactions: mockTransactions,
      total: mockTransactions.length,
    },
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
    error: undefined,
  }),
}));

vi.mock('@/services/addressRealTime', () => ({
  useRealTimeAddressData: () => ({
    data: {
      balance: '1.5',
      balanceWei: '1500000000000000000',
      transactionCount: 42,
      latestBlock: 18000000,
    },
    loading: false,
    fetching: false,
    error: undefined,
  }),
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

  it('shows the empty-state alert when there are no transactions', async () => {
    mocks.addressTransactions = { transactions: [], total: 0 };

    renderPage();

    expect(await screen.findByText('No transactions found')).toBeInTheDocument();
  });

  it('shows unsupported chain error for invalid chain', async () => {
    renderPage(`/chain/999/address/${mocks.testAddress}`);

    expect(await screen.findByText(/Unsupported chain ID/)).toBeInTheDocument();
  });
});
