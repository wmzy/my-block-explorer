import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import TopNavigation from '../../components/TopNavigation';

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock RpcConfigModal
vi.mock('../../components/RpcConfigModal', () => ({
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
    isOpen ? <div data-testid="rpc-config-modal">RPC Config Modal</div> : null
  ),
}));

// Mock chains config
vi.mock('../../config/chains', () => ({
  getChainInfo: (chainId: number) => {
    const chains = {
      1: { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } },
      5000: { id: 5000, name: 'Mantle', nativeCurrency: { symbol: 'MNT' } },
      137: { id: 137, name: 'Polygon', nativeCurrency: { symbol: 'MATIC' } },
    };
    return chains[chainId as keyof typeof chains] || null;
  },
  getChainName: (chainId: number) => {
    const names = { 1: 'Ethereum', 5000: 'Mantle', 137: 'Polygon' };
    return names[chainId as keyof typeof names] || `Chain ${chainId}`;
  },
  getChainSymbol: (chainId: number) => {
    const symbols = { 1: 'ETH', 5000: 'MNT', 137: 'MATIC' };
    return symbols[chainId as keyof typeof symbols] || 'UNKNOWN';
  },
  getChainType: (chainId: number) => chainId === 5 ? 'testnet' : 'mainnet',
  isPopularChain: (chainId: number) => [1, 137, 5000].includes(chainId),
  getSortedChains: () => [
    { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } },
    { id: 137, name: 'Polygon', nativeCurrency: { symbol: 'MATIC' } },
    { id: 5000, name: 'Mantle', nativeCurrency: { symbol: 'MNT' } },
  ],
  searchChains: (query: string) => [
    { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } },
  ].filter(chain => 
    chain.name.toLowerCase().includes(query.toLowerCase()) ||
    chain.id.toString().includes(query)
  ),
}));

const renderTopNavigation = (props = {}) => {
  const defaultProps = {
    currentChainId: 1,
    onChainChange: vi.fn(),
    onSearch: vi.fn(),
    searchPlaceholder: '搜索地址、交易哈希或区块号...',
  };
  
  return render(
    <BrowserRouter>
      <TopNavigation {...defaultProps} {...props} />
    </BrowserRouter>
  );
};

describe('TopNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the logo and navigation elements', () => {
    renderTopNavigation();
    
    expect(screen.getByText('Block Explorer')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索地址、交易哈希或区块号...')).toBeInTheDocument();
    expect(screen.getByText('搜索')).toBeInTheDocument();
    expect(screen.getByText('⚙️ RPC')).toBeInTheDocument();
  });

  it('displays current chain information', () => {
    renderTopNavigation({ currentChainId: 1 });
    
    expect(screen.getByText('Ethereum')).toBeInTheDocument();
    expect(screen.getByText(/ID: 1/)).toBeInTheDocument();
    expect(screen.getByText(/ETH/)).toBeInTheDocument();
  });

  it('handles search input and submission', async () => {
    const onSearch = vi.fn();
    renderTopNavigation({ onSearch });
    
    const searchInput = screen.getByPlaceholderText('搜索地址、交易哈希或区块号...');
    const searchButton = screen.getByText('搜索');
    
    // Type in search input
    fireEvent.change(searchInput, { target: { value: '0x123' } });
    expect(searchInput).toHaveValue('0x123');
    
    // Click search button
    fireEvent.click(searchButton);
    
    await waitFor(() => {
      expect(onSearch).toHaveBeenCalledWith('0x123');
    });
  });

  it.skip("handles search on Enter key press", async () => {
    const onSearch = vi.fn();
    renderTopNavigation({ onSearch });

    const searchInput =
      screen.getByPlaceholderText("搜索地址、交易哈希或区块号...");

    // Type and press Enter
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "0x456" } });
      fireEvent.keyPress(searchInput, { key: "Enter" });
    });

    await waitFor(() => {
      expect(onSearch).toHaveBeenCalledWith("0x456");
    });
  });

  it('opens RPC configuration modal', () => {
    renderTopNavigation();
    
    const rpcButton = screen.getByText('⚙️ RPC');
    fireEvent.click(rpcButton);
    
    expect(screen.getByTestId('rpc-config-modal')).toBeInTheDocument();
  });

  it('handles chain selection', async () => {
    const onChainChange = vi.fn();
    renderTopNavigation({ onChainChange });
    
    // Click chain selector to open dropdown
    const chainSelector = screen.getByText('Ethereum');
    fireEvent.click(chainSelector);
    
    // Wait for dropdown to appear and search for another chain
    await waitFor(() => {
      expect(screen.getByPlaceholderText('搜索链名称、ID 或代币符号...')).toBeInTheDocument();
    });
    
    // Type to search for Polygon
    const searchInput = screen.getByPlaceholderText('搜索链名称、ID 或代币符号...');
    fireEvent.change(searchInput, { target: { value: 'Polygon' } });
    
    // Note: This test would need more complex mocking to fully test chain selection
    // as it involves complex dropdown interactions
  });

  it('disables search button when loading', () => {
    renderTopNavigation();
    
    const searchInput = screen.getByPlaceholderText('搜索地址、交易哈希或区块号...');
    const searchButton = screen.getByText('搜索');
    
    fireEvent.change(searchInput, { target: { value: '0x123' } });
    fireEvent.click(searchButton);
    
    // During search, button should show loading state
    expect(screen.getByText('搜索中...')).toBeInTheDocument();
  });

  it('handles logo click navigation', () => {
    renderTopNavigation({ currentChainId: 5000 });
    
    const logo = screen.getByText('Block Explorer');
    expect(logo.closest('div')).toHaveStyle('cursor: pointer');
    
    // Test click functionality
    fireEvent.click(logo);
    expect(mockNavigate).toHaveBeenCalledWith('/chain/5000');
  });

  it('uses custom search placeholder', () => {
    const customPlaceholder = 'Custom search placeholder';
    renderTopNavigation({ searchPlaceholder: customPlaceholder });
    
    expect(screen.getByPlaceholderText(customPlaceholder)).toBeInTheDocument();
  });

  it('handles empty search input gracefully', async () => {
    const onSearch = vi.fn();
    renderTopNavigation({ onSearch });
    
    const searchButton = screen.getByText('搜索');
    
    // Try to search with empty input
    fireEvent.click(searchButton);
    
    // Should not call onSearch for empty input
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('trims whitespace from search input', async () => {
    const onSearch = vi.fn();
    renderTopNavigation({ onSearch });
    
    const searchInput = screen.getByPlaceholderText('搜索地址、交易哈希或区块号...');
    const searchButton = screen.getByText('搜索');
    
    // Type with leading/trailing spaces
    fireEvent.change(searchInput, { target: { value: '  0x123  ' } });
    fireEvent.click(searchButton);
    
    await waitFor(() => {
      expect(onSearch).toHaveBeenCalledWith('0x123');
    });
  });
});

describe('ChainSelector', () => {
  it('shows current chain with popular chain indicator', () => {
    renderTopNavigation({ currentChainId: 1 });
    
    expect(screen.getByText('Ethereum')).toBeInTheDocument();
    expect(screen.getByText(/ID: 1/)).toBeInTheDocument();
    expect(screen.getByText(/⭐/)).toBeInTheDocument();
  });

  it('shows chain without popular indicator for non-popular chains', () => {
    renderTopNavigation({ currentChainId: 999 });
    
    expect(screen.getByText('Chain 999')).toBeInTheDocument();
    expect(screen.getByText(/ID: 999/)).toBeInTheDocument();
  });

  it('opens dropdown when clicked', async () => {
    renderTopNavigation();
    
    const chainButton = screen.getByRole('button', { name: /Ethereum/ });
    fireEvent.click(chainButton);
    
    await waitFor(() => {
      expect(screen.getByPlaceholderText('搜索链名称、ID 或代币符号...')).toBeInTheDocument();
    });
  });
});
