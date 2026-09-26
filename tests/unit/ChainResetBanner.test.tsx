// ChainResetBanner render contract: it stays invisible without a
// detection, shows the pinned honest copy when the chain's head went
// backwards, keys dismissal by the regressed-from head (a NEW regression
// re-arms the banner), and wires the clear button to the API client —
// success toasts the honest counts and re-baselines detection, a 403
// surfaces the admin-token guidance, other failures surface verbatim.
// The detection hook and the clear client are stubbed at the module
// boundary; the REAL head-keyed dismissal storage runs against jsdom
// localStorage (which is the durable half of the dismiss logic).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ApiError } from '@/util/apiError';
import { ChainResetBanner } from '@/components/ChainResetBanner';
import type { ChainResetState } from '@/services/chainReset';

const mocks = vi.hoisted(() => ({
  useChainResetDetection: vi.fn<() => ChainResetState>(),
  clearChainCachedData: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock('@/services/chainReset', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/chainReset')>();
  return {
    ...actual,
    useChainResetDetection: mocks.useChainResetDetection,
    clearChainCachedData: mocks.clearChainCachedData,
  };
});

const CHAIN = 31337;

const detect = (state: ChainResetState) =>
  mocks.useChainResetDetection.mockReturnValue(state);

const suspectedAt = (blockNumber: number): ChainResetState => ({
  suspected: true,
  storedHead: { blockNumber, updatedAt: 1_000 },
});

const renderBanner = (head: bigint | null = 4n) =>
  render(<ChainResetBanner chainId={CHAIN} head={head} />);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  detect({ suspected: false, storedHead: null });
});

describe('visibility', () => {
  it('renders nothing without a detection', () => {
    detect({ suspected: false, storedHead: { blockNumber: 100, updatedAt: 1 } });
    const { container } = renderBanner();

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while the head is still unknown (feeds loading)', () => {
    detect({ suspected: false, storedHead: null });
    const { container } = renderBanner(null);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the pinned honest copy when a regression is detected', () => {
    detect(suspectedAt(1_200));
    renderBanner(4n);

    expect(screen.getByTestId('chain-reset-lead')).toHaveTextContent(
      'This chain looks like it was reset — cached contract data may be stale.',
    );
    // The detail names both heads and the honest scope (cached-immutable
    // entries only; event data kept).
    expect(screen.getByTestId('chain-reset-body')).toHaveTextContent('1,200');
    expect(screen.getByTestId('chain-reset-body')).toHaveTextContent('refetched on demand');
    expect(screen.getByTestId('chain-reset-body')).toHaveTextContent('event data is kept');
  });
});

describe('dismissal is keyed by the regressed-from head', () => {
  it('stays hidden when this exact regression was already dismissed', () => {
    localStorage.setItem('be:chainResetDismissed:31337:1200', '1');
    detect(suspectedAt(1_200));

    const { container } = renderBanner();

    expect(container).toBeEmptyDOMElement();
  });

  it('hides on the Dismiss click and persists the head-keyed mark', () => {
    detect(suspectedAt(1_200));
    renderBanner();

    // Visible before the click (guards the later absence assertion from
    // being vacuously true).
    expect(screen.getByTestId('chain-reset-lead')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('chain-reset-dismiss'));

    expect(screen.queryByTestId('chain-reset-lead')).not.toBeInTheDocument();
    expect(localStorage.getItem('be:chainResetDismissed:31337:1200')).toBe('1');
  });

  it('re-arms for a NEW regression (a different high-water head)', () => {
    // The old regression's dismissal must not silence a later one.
    localStorage.setItem('be:chainResetDismissed:31337:1200', '1');
    detect(suspectedAt(2_500));

    renderBanner();

    expect(screen.getByTestId('chain-reset-lead')).toBeInTheDocument();
  });
});

describe('Clear cached data', () => {
  it('calls the client for the chain and toasts the honest counts on success', async () => {
    detect(suspectedAt(1_200));
    mocks.clearChainCachedData.mockResolvedValue({ contractSources: 3, storageLayouts: 1 });
    renderBanner(4n);

    fireEvent.click(screen.getByTestId('chain-reset-clear'));

    await waitFor(() =>
      expect(screen.getByTestId('chain-reset-cleared-note')).toHaveTextContent(
        'Cleared 3 contract sources and 1 storage layout',
      ),
    );
    expect(mocks.clearChainCachedData).toHaveBeenCalledWith(CHAIN);
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining('3 cached contract sources and 1 storage layout'),
    );
  });

  it('re-baselines detection to the post-reset head after a successful clear', async () => {
    detect(suspectedAt(1_200));
    mocks.clearChainCachedData.mockResolvedValue({ contractSources: 0, storageLayouts: 0 });
    renderBanner(4n);

    fireEvent.click(screen.getByTestId('chain-reset-clear'));
    await waitFor(() => expect(mocks.clearChainCachedData).toHaveBeenCalled());

    // acknowledgeChainReset is the REAL function from the partial mock:
    // the stored high-water head must now read as the current head.
    await waitFor(() => {
      const raw = localStorage.getItem('be:lastHead:31337');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw as string).blockNumber).toBe(4);
    });
  });

  it('surfaces the admin-token guidance on a 403', async () => {
    detect(suspectedAt(1_200));
    mocks.clearChainCachedData.mockRejectedValue(
      new ApiError('Invalid admin token.', 403),
    );
    renderBanner(4n);

    fireEvent.click(screen.getByTestId('chain-reset-clear'));

    await waitFor(() =>
      expect(screen.getByTestId('chain-reset-error')).toHaveTextContent(
        'Requires admin token — set it via ⚙ RPC → Admin token.',
      ),
    );
    // The banner stays: the failure is recoverable by entering a token.
    expect(screen.getByTestId('chain-reset-lead')).toBeInTheDocument();
  });

  it('surfaces other API errors verbatim and non-API failures honestly', async () => {
    detect(suspectedAt(1_200));
    mocks.clearChainCachedData.mockRejectedValueOnce(new ApiError('duckdb hiccup', 500));
    renderBanner(4n);

    fireEvent.click(screen.getByTestId('chain-reset-clear'));
    await waitFor(() =>
      expect(screen.getByTestId('chain-reset-error')).toHaveTextContent('duckdb hiccup'),
    );

    // A non-API failure (e.g. no backend at all) gets the honest fallback.
    mocks.clearChainCachedData.mockRejectedValueOnce(new Error('network gone'));
    fireEvent.click(screen.getByTestId('chain-reset-clear'));
    await waitFor(() =>
      expect(screen.getByTestId('chain-reset-error')).toHaveTextContent(
        'Could not clear the cached data — the explorer API is unreachable or returned an error.',
      ),
    );
  });
});
