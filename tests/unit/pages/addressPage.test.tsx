import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@testing-library/jest-dom';
import AddressPage from '@/pages/AddressPage';

vi.mock('../../../components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">
      TopNav chain=
      {currentChainId}
    </div>
  ),
}));

vi.mock('../../../config/chains', () => ({
  getChainInfo: (chainId: number) => {
    if (chainId === 1)
      return { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } };
    return null;
  },
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : 'Unknown'),
  getChainSymbol: (chainId: number) => (chainId === 1 ? 'ETH' : 'UNKNOWN'),
}));

vi.mock('../../../hooks/useAddressData', () => ({
  useAddressData: () => ({
    persistent: {
      isContract: false,
      contractName: null,
      verificationStatus: null,
      sourceCodeAvailable: false,
    },
    realTime: {
      balance: '1.5',
      transactionCount: 42,
      latestBlock: 18000000,
    },
    loading: { persistent: false, realTime: false },
    error: { persistent: null, realTime: null },
  }),
}));

vi.mock('@/utils/format', () => ({
  formatRelativeTime: () => '3 min ago',
}));

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

const renderPage = (path = `/chain/1/address/${testAddress}`) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/chain/:chainId/address/:address"
          element={<AddressPage />}
        />
      </Routes>
    </MemoryRouter>,
  );

describe('AddressPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: mockTransactions,
          pagination: { totalPages: 1 },
        }),
    });
  });

  it('renders TopNavigation', () => {
    renderPage();
    expect(screen.getByTestId('top-navigation')).toBeInTheDocument();
  });

  it('displays address details header', () => {
    renderPage();
    expect(screen.getByText('Address Details')).toBeInTheDocument();
    expect(screen.getByText(/Ethereum/)).toBeInTheDocument();
  });

  it('shows address overview with balance', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument();
      expect(screen.getByText(testAddress)).toBeInTheDocument();
      expect(screen.getByText(/1\.5 ETH/)).toBeInTheDocument();
    });
  });

  it('shows transaction count from real-time data', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
    });
  });

  it('renders Recent Transactions section', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Recent Transactions')).toBeInTheDocument();
    });
  });

  it('displays transaction direction badges', async () => {
    renderPage();

    await waitFor(() => {
      const outBadges = screen.getAllByText('OUT');
      const inBadges = screen.getAllByText('IN');
      expect(outBadges.length).toBeGreaterThan(0);
      expect(inBadges.length).toBeGreaterThan(0);
    });
  });

  it('shows unsupported chain error for invalid chain', () => {
    render(
      <MemoryRouter initialEntries={[`/chain/999/address/${testAddress}`]}>
        <Routes>
          <Route
            path="/chain/:chainId/address/:address"
            element={<AddressPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Unsupported chain ID/)).toBeInTheDocument();
  });
});
