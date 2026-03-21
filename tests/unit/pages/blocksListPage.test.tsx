import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@testing-library/jest-dom';
import BlocksListPage from '@/pages/BlocksListPage';

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
    if (chainId === 1) return { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } };
    return null;
  },
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : 'Unknown'),
}));

vi.mock('@/utils/format', () => ({
  formatNumber: (n: number) => n.toLocaleString(),
  formatRelativeTime: () => '2 min ago',
}));

const mockBlocks = [
  {
    number: '18000001',
    hash: '0xabc1',
    timestamp: '2024-01-01T00:00:00Z',
    miner: '0x1234567890abcdef1234567890abcdef12345678',
    gasUsed: '15000000',
    gasLimit: '30000000',
    transactionCount: 150,
  },
  {
    number: '18000000',
    hash: '0xabc0',
    timestamp: '2024-01-01T00:00:00Z',
    miner: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    gasUsed: '12000000',
    gasLimit: '30000000',
    transactionCount: 120,
  },
];

const renderPage = (path = '/chain/1/blocks') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/chain/:chainId/blocks" element={<BlocksListPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('BlocksListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders TopNavigation and page header', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: mockBlocks,
          pagination: { totalPages: 5 },
        }),
    });

    renderPage();

    expect(screen.getByTestId('top-navigation')).toBeInTheDocument();
    expect(screen.getByText('Blocks')).toBeInTheDocument();
    expect(screen.getByText(/Ethereum/)).toBeInTheDocument();
  });

  it('displays loading state initially', () => {
    (global.fetch as any).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Loading blocks...')).toBeInTheDocument();
  });

  it('displays blocks after loading', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: mockBlocks,
          pagination: { totalPages: 5 },
        }),
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('150')).toBeInTheDocument();
      expect(screen.getByText('120')).toBeInTheDocument();
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
      expect(screen.getByText(/HTTP 500: Internal Server Error/)).toBeInTheDocument();
    });
  });

  it('shows unsupported chain error for invalid chain', () => {
    render(
      <MemoryRouter initialEntries={['/chain/999/blocks']}>
        <Routes>
          <Route path="/chain/:chainId/blocks" element={<BlocksListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Unsupported chain ID/)).toBeInTheDocument();
  });

  it('has pagination controls', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: mockBlocks,
          pagination: { totalPages: 5 },
        }),
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Page 1 of 5')).toBeInTheDocument();
      expect(screen.getByText('Previous')).toBeDisabled();
      expect(screen.getByText('Next')).not.toBeDisabled();
    });
  });
});
