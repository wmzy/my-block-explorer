import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@testing-library/jest-dom';
import TransactionsListPage from '../../../pages/TransactionsListPage';

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

vi.mock('@/utils/format', () => ({
  formatNumber: (n: number) => n.toLocaleString(),
  formatRelativeTime: () => '5 min ago',
}));

const mockTransactions = [
  {
    hash: '0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1',
    blockNumber: '18000001',
    fromAddress: '0x1234567890abcdef1234567890abcdef12345678',
    toAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    value: '1000000000000000000',
    status: 1,
    timestamp: '2024-01-01T00:00:00Z',
  },
  {
    hash: '0xdef789abc123def789abc123def789abc123def789abc123def789abc123def7',
    blockNumber: '18000000',
    fromAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    toAddress: '0x1234567890abcdef1234567890abcdef12345678',
    value: '0',
    status: 0,
    timestamp: '2024-01-01T00:00:00Z',
  },
];

const renderPage = (path = '/chain/1/transactions') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/chain/:chainId/transactions"
          element={<TransactionsListPage />}
        />
      </Routes>
    </MemoryRouter>,
  );

describe('TransactionsListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders TopNavigation and page header', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: mockTransactions,
          pagination: { totalPages: 3 },
        }),
    });

    renderPage();

    expect(screen.getByTestId('top-navigation')).toBeInTheDocument();
    expect(screen.getByText('Transactions')).toBeInTheDocument();
    expect(screen.getByText(/Ethereum/)).toBeInTheDocument();
  });

  it('displays loading state initially', () => {
    (global.fetch as any).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Loading transactions...')).toBeInTheDocument();
  });

  it('displays transactions after loading', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: mockTransactions,
          pagination: { totalPages: 3 },
        }),
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Success')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
    });
  });

  it('displays error on fetch failure', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText(/HTTP 500: Internal Server Error/),
      ).toBeInTheDocument();
    });
  });

  it('shows unsupported chain error for invalid chain', () => {
    render(
      <MemoryRouter initialEntries={['/chain/999/transactions']}>
        <Routes>
          <Route
            path="/chain/:chainId/transactions"
            element={<TransactionsListPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Unsupported chain ID/)).toBeInTheDocument();
  });

  it('shows correct status badges', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: mockTransactions,
          pagination: { totalPages: 1 },
        }),
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Success')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
    });
  });

  it('has pagination controls', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: mockTransactions,
          pagination: { totalPages: 3 },
        }),
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
      expect(screen.getByText('Previous')).toBeDisabled();
      expect(screen.getByText('Next')).not.toBeDisabled();
    });
  });
});
