// /signatures tool page behavioral contract, driven through a mocked
// useSignatureLookup: the ?q= deep link pre-fills the input and
// auto-searches; selector queries populate the Functions section and
// topic0 queries the Events section (the other side explains why it is
// empty); an honest registry miss renders the empty state, never an
// error; backend-offline failures render the standard offline attribution
// while upstream unavailability renders its own retryable state; name
// fragments degrade to the exact-signature explanation with submission
// disabled; and Enter commits the query to the URL immediately while
// typing debounces.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes, useSearchParams } from '@native-router/react';
import '@testing-library/jest-dom';

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">chain:{currentChainId}</div>
  ),
}));

// The view reaches the discovery layer for backend-offline recovery (the
// same reconnect the connection badge uses); the harness has no provider,
// so the context hook is mocked at module level (contractPage pattern).
const mockReconnect = vi.fn(async (): Promise<{ url: string } | null> => null);
vi.mock('@/hooks/ServiceDiscoveryContext', () => ({
  useServiceDiscovery: () => ({ reconnect: mockReconnect }),
}));

type FoundOutcome = {
  kind: 'function' | 'event';
  signatures: string[];
  source: 'openchain';
};

type MockLookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; outcome: FoundOutcome }
  | { status: 'miss' }
  | { status: 'unavailable' }
  | { status: 'error'; error: unknown };

const mockRefetch = vi.fn();
const mockUseSignatureLookup = vi.fn();

vi.mock('@/services/signatures', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/signatures')>();
  return {
    ...actual,
    useSignatureLookup: (selector: string | undefined) => mockUseSignatureLookup(selector),
  };
});

import { ApiError } from '@/util/apiError';
import SignaturesView from '@/views/Signatures';

const SELECTOR = '0xa9059cbb';
const TOPIC0 = `0x${'cd'.repeat(32)}`;

const fnFound: FoundOutcome = {
  kind: 'function',
  signatures: ['transfer(address,uint256)'],
  source: 'openchain',
};
const eventFound: FoundOutcome = {
  kind: 'event',
  signatures: ['Transfer(address,address,uint256)'],
  source: 'openchain',
};

const lookupResult = (state: MockLookupState) => ({ ...state, refetch: mockRefetch });

// Echo settle: whatever selector the view asks for resolves found — the
// shape the real hook produces once its fetch lands.
const echoFound = (outcome: FoundOutcome) => {
  mockUseSignatureLookup.mockImplementation((selector: string | undefined) =>
    selector === undefined
      ? lookupResult({ status: 'idle' })
      : lookupResult({ status: 'found', outcome }),
  );
};

// Exposes the current search string so ?q= writes are observable
// (transactionsListPage probe pattern).
function SearchProbe() {
  const [searchParams] = useSearchParams();
  return <div data-testid="search-probe">{searchParams.toString()}</div>;
}

const renderPage = (path: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([{ path: '/signatures', component: () => SignaturesView }])}
      initialEntries={[path]}
    >
      <View />
      <SearchProbe />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockUseSignatureLookup.mockReturnValue(lookupResult({ status: 'idle' }));
});

describe('Signatures tool page', () => {
  it('auto-searches a deep-linked selector: Functions rows, Events side note, prefilled input', async () => {
    echoFound(fnFound);

    renderPage(`/signatures?q=${SELECTOR}`);

    // Deep link: input prefilled (the route component mounts
    // asynchronously — await it before pinning), hook keyed to the
    // classified selector.
    expect(await screen.findByLabelText('Signature lookup query')).toHaveValue(SELECTOR);
    await waitFor(() => expect(mockUseSignatureLookup).toHaveBeenLastCalledWith(SELECTOR));

    // Both sections render: the applicable one with the resolved row…
    expect(await screen.findByText('transfer(address,uint256)')).toBeInTheDocument();
    expect(screen.getByText('openchain')).toBeInTheDocument();
    // …the other with an explicit why-empty note, never a fake miss.
    expect(screen.getByRole('heading', { name: 'Functions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByText(/event topic0 hashes \(0x \+ 64 hex characters\) resolve here/))
      .toBeInTheDocument();
    expect(screen.queryByText('No match in the openchain registry.')).not.toBeInTheDocument();
  });

  it('resolves a deep-linked topic0 into the Events section', async () => {
    echoFound(eventFound);

    renderPage(`/signatures?q=${TOPIC0}`);

    expect(await screen.findByText('Transfer(address,address,uint256)')).toBeInTheDocument();
    expect(mockUseSignatureLookup).toHaveBeenLastCalledWith(TOPIC0);
    expect(screen.getByText(/function selectors \(0x \+ 8 hex characters\) resolve here/))
      .toBeInTheDocument();
  });

  it('renders a skeleton while the lookup is loading, never a premature state', async () => {
    mockUseSignatureLookup.mockReturnValue(lookupResult({ status: 'loading' }));

    renderPage(`/signatures?q=${SELECTOR}`);

    expect(await screen.findByRole('heading', { name: 'Functions' })).toBeInTheDocument();
    expect(screen.queryByText('No match in the openchain registry.')).not.toBeInTheDocument();
    expect(screen.queryByText('transfer(address,uint256)')).not.toBeInTheDocument();
  });

  it('treats a registry miss as an explained empty state, not an error', async () => {
    mockUseSignatureLookup.mockReturnValue(lookupResult({ status: 'miss' }));

    renderPage(`/signatures?q=${SELECTOR}`);

    expect(await screen.findByText('No match in the openchain registry.')).toBeInTheDocument();
    expect(screen.getByText(/not proof that no signature exists/)).toBeInTheDocument();
    // No retry affordances — a miss is settled fact.
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
    expect(screen.queryByText('Retry lookup')).not.toBeInTheDocument();
  });

  it('renders the offline attribution for a backend-unreachable failure and retries the connection', async () => {
    mockUseSignatureLookup.mockReturnValue(
      lookupResult({
        status: 'error',
        error: new ApiError('Backend not connected — indexed data unavailable', 0),
      }),
    );

    renderPage(`/signatures?q=${SELECTOR}`);

    expect(await screen.findByText('Backend offline — indexed data unavailable.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry connection'));
    await waitFor(() => expect(mockReconnect).toHaveBeenCalledTimes(1));
  });

  it('renders the retryable error state for non-offline failures', async () => {
    mockUseSignatureLookup.mockReturnValue(
      lookupResult({ status: 'error', error: new ApiError('Signature lookup failed', 500) }),
    );

    renderPage(`/signatures?q=${SELECTOR}`);

    expect(await screen.findByText('Signature lookup failed')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('renders its own retryable state when the openchain upstream is unavailable', async () => {
    mockUseSignatureLookup.mockReturnValue(lookupResult({ status: 'unavailable' }));

    renderPage(`/signatures?q=${SELECTOR}`);

    expect(await screen.findByText(/Lookup unavailable right now/)).toBeInTheDocument();
    expect(screen.getByText(/not a “no match” result/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry lookup'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('degrades name fragments honestly: explanation, no query, submission disabled', async () => {
    renderPage('/signatures?q=transfer(address,uint256)');

    expect(
      await screen.findByText(/Name search needs an exact signature — enter a 4-byte selector/),
    ).toBeInTheDocument();
    // No request is ever issued for a fragment.
    expect(mockUseSignatureLookup).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByText('Look up')).toBeDisabled();
    // No result sections render for an unrunnable query.
    expect(screen.queryByRole('heading', { name: 'Functions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Events' })).not.toBeInTheDocument();
  });

  it('guides invalid queries without fetching', async () => {
    renderPage('/signatures?q=0x1234');

    expect(await screen.findByText(/4 hex characters after 0x/)).toBeInTheDocument();
    expect(mockUseSignatureLookup).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByText('Look up')).toBeDisabled();
  });

  it('renders the idle hint and no sections for a bare visit', async () => {
    renderPage('/signatures');

    expect(await screen.findByText(/Enter a function selector or an event topic0/))
      .toBeInTheDocument();
    expect(mockUseSignatureLookup).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByText('Look up')).toBeDisabled();
  });

  it('commits Enter immediately while typing only debounces into ?q=', async () => {
    echoFound(fnFound);

    renderPage('/signatures');

    const input = await screen.findByLabelText('Signature lookup query');
    fireEvent.change(input, { target: { value: SELECTOR } });

    // Right after the keystroke the URL has not moved yet (debounce).
    expect(screen.getByTestId('search-probe').textContent).toBe('');

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.getByTestId('search-probe').textContent).toBe(`q=${SELECTOR}`),
    );
    // The input keeps leading across its own URL write, and the committed
    // selector drives the lookup (auto-search after submit).
    expect(screen.getByLabelText('Signature lookup query')).toHaveValue(SELECTOR);
    expect(await screen.findByText('transfer(address,uint256)')).toBeInTheDocument();
  });

  it('debounces typed queries into the URL without Enter', async () => {
    echoFound(fnFound);

    renderPage('/signatures');

    const input = await screen.findByLabelText('Signature lookup query');
    fireEvent.change(input, { target: { value: SELECTOR } });

    await waitFor(
      () => expect(screen.getByTestId('search-probe').textContent).toBe(`q=${SELECTOR}`),
      { timeout: 2000 },
    );
    expect(await screen.findByText('transfer(address,uint256)')).toBeInTheDocument();
  });

  it('copies a resolved signature with honest clipboard feedback', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    echoFound(fnFound);
    renderPage(`/signatures?q=${SELECTOR}`);
    await screen.findByText('transfer(address,uint256)');

    fireEvent.click(screen.getByText('Copy'));
    expect(writeText).toHaveBeenCalledWith('transfer(address,uint256)');
    expect(await screen.findByText('Copied ✓')).toBeInTheDocument();
  });
});
