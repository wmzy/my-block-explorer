// Contract view smoke tests: the view rendered under a minimal native-router
// harness (the route table Wave 4 wires will mount the same two C5 paths —
// /contract/:address and its /events subpath — onto this view). Services
// and network-adjacent children are mocked; assertions cover the header +
// info card + tab bar, the unsupported-chain branch, the /events default
// tab, the ?tab= write path, and the chain-switch navigation. Router view
// commits resolve asynchronously, so first paint assertions use findBy*.
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, View, createRoutes, useSearchParams } from '@native-router/react';

import Contract from '@/views/Contract';
import { post } from '@/util/http';
import { ApiError } from '@/util/apiError';
import { createRpcClient } from '@/utils/realTimeData';
import {
  EIP1967_BEACON_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
} from '@/utils/proxyDetection';
import type { PublicClient } from 'viem';
import {
  useContractCreation,
  useContractSource,
  useStorageLayout,
} from '@/services/contracts';

// jsdom implements neither Element.scrollIntoView nor :focus scrolling; the
// custom ABI panel's focus signal calls both.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

vi.mock('@/services/contracts', () => ({
  useContractSource: vi.fn(),
  useContractCreation: vi.fn(),
  useStorageLayout: vi.fn(),
}));

// The view's on-chain proxy probe reaches the browser RPC client (code +
// storage slots + the beacon's implementation() static call). The factory
// mock keeps the real module (and its RPC config loading) out of jsdom;
// per-test mocks below shape the probe's answers.
vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(),
}));

vi.mock('@/components/TopNavigation', async () => {
  const React = await import('react');
  return {
    default: (props: { currentChainId: number; onChainChange: (id: number) => void }) =>
      React.createElement('div', {
        'data-testid': 'top-navigation',
        'data-chain-id': props.currentChainId,
        'onClick': () => props.onChainChange(137),
      }),
  };
});

vi.mock('@/components/SourceCodeViewer', async () => {
  const React = await import('react');
  return {
    SourceCodeViewer: (props: { sourceCode: string }) =>
      React.createElement('pre', { 'data-testid': 'source-viewer' }, props.sourceCode),
  };
});

vi.mock('@/components/RpcConfig', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div') };
});

vi.mock('@/components/events/IndexingRangeManager', async () => {
  const React = await import('react');
  return {
    default: () => React.createElement('div', { 'data-testid': 'indexing-range-manager' }),
  };
});

vi.mock('@/components/events/EventStatistics', async () => {
  const React = await import('react');
  return {
    default: () => React.createElement('div', { 'data-testid': 'event-statistics' }),
  };
});

vi.mock('@/components/events/EventTable', async () => {
  const React = await import('react');
  return {
    // Echoes the decoded event names so tests can assert which abiEvents
    // reached the table.
    default: (props: { abiEvents?: Array<{ name?: string }> }) =>
      React.createElement(
        'div',
        { 'data-testid': 'event-table' },
        (props.abiEvents ?? []).map(event => event.name).join(','),
      ),
  };
});

vi.mock('@/views/Contract/ContractInteract', async () => {
  const React = await import('react');
  return {
    // Echoes the abiOverride prop so tests can assert the paste-ABI handoff
    // without depending on ContractInteract's own data loading.
    ContractInteract: (props: { abiOverride?: string }) =>
      React.createElement('div', {
        'data-testid': 'contract-interact',
        'data-abi-override': props.abiOverride ?? '',
      }),
  };
});

vi.mock('@/util/http', async importOriginal => {
  // Keep the real isBackendUnreachable: a pure predicate over the error
  // class, needed by the view's backend-offline attribution branch.
  const actual = await importOriginal<typeof import('@/util/http')>();
  return {
    ...actual,
    get: vi.fn(async () => ({ ides: [] })),
    post: vi.fn(async () => ({})),
  };
});

// The view reaches the discovery layer for backend-offline recovery (the
// same reconnect the connection badge uses); the harness has no provider,
// so the context hook is mocked at module level. Typed structurally to the
// real reconnect(): Promise<ServiceInfo | null> — the view only checks
// whether a service came back.
const mockReconnect = vi.fn(async (): Promise<{ url: string } | null> => null);
vi.mock('@/hooks/ServiceDiscoveryContext', () => ({
  useServiceDiscovery: () => ({ reconnect: mockReconnect }),
}));

const ADDRESS = '0xabc0000000000000000000000000000000000001';

const verifiedSourceResponse = {
  contractSource: {
    chainId: 1,
    address: ADDRESS,
    name: 'TestToken',
    sourceCode: 'pragma solidity ^0.8.0;',
    abi: JSON.stringify([
      { type: 'function', name: 'name', inputs: [], outputs: [], stateMutability: 'view' },
      { type: 'event', name: 'Transfer', inputs: [] },
    ]),
    verificationStatus: 'verified',
    verificationSource: 'sourcify',
    lastChecked: '2026-01-01T00:00:00Z',
  },
};

// Unverified contract: verification services know nothing, so the server
// answers without an ABI and the paste-ABI unlock takes over.
const unverifiedSourceResponse = {
  contractSource: {
    chainId: 1,
    address: ADDRESS,
    sourceCode: '',
    abi: '',
    verificationStatus: 'unverified',
    verificationSource: 'none',
    lastChecked: '2026-01-01T00:00:00Z',
  },
};

// Verified contract whose ABI carries functions but no events: the Events
// tab must stay rendered (indexed ranges remain queryable) while the table
// loses decoding/filtering.
const noEventsSourceResponse = {
  contractSource: {
    ...verifiedSourceResponse.contractSource,
    abi: JSON.stringify([
      { type: 'function', name: 'name', inputs: [], outputs: [], stateMutability: 'view' },
    ]),
  },
};

// Pasted-ABI fixture: an event (gates the Events tab), a function (for
// Interact) and a name-less constructor entry — name is optional per the
// ABI spec, so validation must accept it.
const CUSTOM_ABI = JSON.stringify([
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'name',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  { type: 'constructor', inputs: [] },
]);

const CUSTOM_ABI_STORAGE_KEY = `custom-abi:1:${ADDRESS}`;

// The three query hooks share one result shape; cast through unknown+never
// so a single helper serves every mockReturnValue (each hook's exact
// QueryResult is enforced by mockReturnValue itself).
const mockHookResult = (data: unknown) =>
  ({ data, loading: false, error: undefined, refetch: vi.fn() }) as unknown as never;

// Failure shape for the error-path tests; exposes the refetch spy so the
// reconnect flow can assert the post-recovery reload.
const mockHookError = (error: unknown) => {
  const refetch = vi.fn();
  return { result: { data: undefined, loading: false, error, refetch } as never, refetch };
};

// Exposes the current search string so URL writes are observable.
function SearchProbe() {
  const [searchParams] = useSearchParams();
  return <div data-testid="search-probe">{searchParams.toString()}</div>;
}

// Minimal harness: the C5 contract routes (both paths render the same view).
function renderAt(path: string) {
  const routes = createRoutes([
    { path: '/chain/:chainId/contract/:address', component: () => Contract },
    { path: '/chain/:chainId/contract/:address/events', component: () => Contract },
  ]);
  return render(
    <MemoryRouter routes={routes} initialEntries={[path]}>
      <SearchProbe />
      <View />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.mocked(post).mockReset();
  vi.mocked(post).mockResolvedValue({});
  mockReconnect.mockReset();
  mockReconnect.mockResolvedValue(null);
  vi.mocked(useContractSource).mockReturnValue(mockHookResult(verifiedSourceResponse));
  vi.mocked(useContractCreation).mockReturnValue(mockHookResult({ found: false }));
  vi.mocked(useStorageLayout).mockReturnValue(mockHookResult(undefined));
});

describe('Contract view', () => {
  it('renders the header, contract info card and tab bar on the source tab', async () => {
    renderAt(`/chain/1/contract/${ADDRESS}`);

    expect(await screen.findByRole('heading', { name: 'Contract Source Code' })).toBeInTheDocument();
    expect(screen.getByText(/Ethereum/)).toBeInTheDocument();
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
    expect(screen.getByText('TestToken')).toBeInTheDocument();
    expect(screen.getByText('verified')).toBeInTheDocument();
    // Source tab active: viewer mounted, tab bar complete (ABI has 1 event).
    expect(screen.getByTestId('source-viewer')).toBeInTheDocument();
    for (const label of ['Source Code', 'ABI', 'Events (1)', 'Storage', 'Interact']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('renders the unsupported-chain recovery state instead of a dead end', async () => {
    renderAt('/chain/1234567/contract/0xdead');

    // Same UnsupportedChainState as Home/Blocks: names the requested id and
    // offers the deterministic recovery CTAs.
    expect(
      await screen.findByText(/Chain not supported: this explorer has no configuration/),
    ).toBeInTheDocument();
    expect(screen.getByText(/chain ID 1234567/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Mainnet' })).toBeInTheDocument();
    // In-card chain list replaces the old '/' bounce CTA.
    expect(screen.getByRole('heading', { name: 'Open a supported chain' })).toBeInTheDocument();
    expect(screen.queryByText('Contract Source Code')).not.toBeInTheDocument();
  });

  it('defaults to the events tab on the /events subpath', async () => {
    renderAt(`/chain/1/contract/${ADDRESS}/events`);

    expect(await screen.findByTestId('event-table')).toBeInTheDocument();
    expect(screen.getByTestId('event-statistics')).toBeInTheDocument();
    expect(screen.getByTestId('indexing-range-manager')).toBeInTheDocument();
    expect(screen.queryByTestId('source-viewer')).not.toBeInTheDocument();
  });

  it('writes ?tab= on tab clicks and switches panels', async () => {
    const user = userEvent.setup();
    renderAt(`/chain/1/contract/${ADDRESS}`);

    await user.click(await screen.findByRole('button', { name: 'ABI' }));

    expect(await screen.findByRole('heading', { name: 'Contract ABI' })).toBeInTheDocument();
    expect(screen.getByTestId('search-probe')).toHaveTextContent('tab=abi');
    // Panel switched: the ABI tab renders the pretty-printed ABI, not the
    // Solidity source.
    expect(screen.getByText(/"type": "event"/)).toBeInTheDocument();
    expect(screen.queryByText(/pragma solidity/)).not.toBeInTheDocument();
  });

  it('navigates to the same contract on another chain from the top navigation', async () => {
    const user = userEvent.setup();
    renderAt(`/chain/1/contract/${ADDRESS}`);

    await user.click(await screen.findByTestId('top-navigation'));

    // Chain switched: nav reflects 137 and the header chain name changed
    // (Polygon also matches the external PolygonScan tool link, so assert
    // presence, not uniqueness).
    expect(screen.getAllByText(/Polygon/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('top-navigation')).toHaveAttribute('data-chain-id', '137');
  });
});

describe('Contract view custom ABI unlock', () => {
  it('offers the Use custom ABI affordance when the server has no ABI', async () => {
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    expect(await screen.findByRole('heading', { name: 'Use custom ABI' })).toBeInTheDocument();
    // The Events tab stays rendered without any ABI (indexed ranges are
    // queryable regardless — no count badge until events can be decoded),
    // and Apply stays disabled until something is pasted.
    expect(screen.getByRole('button', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('rejects a malformed pasted ABI inline without applying it', async () => {
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    // A JSON object instead of the required array of entries.
    fireEvent.change(await screen.findByLabelText('Custom ABI JSON'), {
      target: { value: '{"type":"function"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'ABI must be a JSON array of entries with a string "type" field',
    );
    expect(screen.getByRole('button', { name: 'Events' })).toBeInTheDocument();
    expect(sessionStorage.getItem(CUSTOM_ABI_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(CUSTOM_ABI_STORAGE_KEY)).toBeNull();
  });

  it('unlocks Events and hands the raw ABI to Interact after Apply', async () => {
    const user = userEvent.setup();
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    fireEvent.change(await screen.findByLabelText('Custom ABI JSON'), {
      target: { value: CUSTOM_ABI },
    });
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    // Badge appears in the tab bar and the raw string is persisted in
    // localStorage (and any legacy sessionStorage copy is dropped).
    expect(await screen.findByText('Custom ABI')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Events (1)' })).toBeInTheDocument();
    expect(localStorage.getItem(CUSTOM_ABI_STORAGE_KEY)).toBe(CUSTOM_ABI);
    expect(sessionStorage.getItem(CUSTOM_ABI_STORAGE_KEY)).toBeNull();

    // The custom events reach the event table.
    await user.click(screen.getByRole('button', { name: 'Events (1)' }));
    expect(await screen.findByTestId('event-table')).toHaveTextContent('Transfer');

    // Interact receives the pasted ABI while no server ABI exists.
    await user.click(screen.getByRole('button', { name: 'Interact' }));
    expect(await screen.findByTestId('contract-interact')).toHaveAttribute(
      'data-abi-override',
      CUSTOM_ABI,
    );
  });

  it('restores a persisted ABI on load and Clear removes it', async () => {
    const user = userEvent.setup();
    localStorage.setItem(CUSTOM_ABI_STORAGE_KEY, CUSTOM_ABI);
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    // Lazy-initialised from localStorage without any typing.
    expect(await screen.findByRole('button', { name: 'Events (1)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Custom ABI JSON')).toHaveValue(CUSTOM_ABI);
    // No server ABI exists here, so the paste is in use — no shadow notice.
    expect(screen.queryByText(/no longer used/)).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Clear custom ABI' }));

    // The tab itself stays (ranges remain queryable) but loses its count.
    expect(screen.getByRole('button', { name: 'Events' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Events (1)' })).not.toBeInTheDocument();
    expect(screen.queryByText('Custom ABI')).not.toBeInTheDocument();
    expect(localStorage.getItem(CUSTOM_ABI_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(CUSTOM_ABI_STORAGE_KEY)).toBeNull();
    expect(screen.getByLabelText('Custom ABI JSON')).toHaveValue('');
  });

  it('adopts a legacy sessionStorage entry into localStorage on load', async () => {
    // Pre-persistence browsers only had sessionStorage: the first load
    // after the upgrade migrates the entry instead of losing the unlock.
    sessionStorage.setItem(CUSTOM_ABI_STORAGE_KEY, CUSTOM_ABI);
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    expect(await screen.findByRole('button', { name: 'Events (1)' })).toBeInTheDocument();
    expect(localStorage.getItem(CUSTOM_ABI_STORAGE_KEY)).toBe(CUSTOM_ABI);
    expect(sessionStorage.getItem(CUSTOM_ABI_STORAGE_KEY)).toBeNull();
  });
});

describe('Contract view custom ABI shadowed by a server ABI', () => {
  it('warns when verification supersedes a stored paste; Keep hides it for the session', async () => {
    const user = userEvent.setup();
    localStorage.setItem(CUSTOM_ABI_STORAGE_KEY, CUSTOM_ABI);
    // verifiedSourceResponse is the beforeEach default: the server ABI is
    // back, so the stored paste is silently unused.
    renderAt(`/chain/1/contract/${ADDRESS}`);

    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(
      'This contract is now verified server-side — your pasted custom ABI is no longer used.',
    );

    // The tab-bar badge stays visible and names the unused state.
    expect(screen.getByTitle(/not used while a verified source is available/)).toHaveTextContent(
      'Custom ABI',
    );

    // The server ABI drives the tabs (the paste does not shadow it back),
    // and the paste-ABI panel is not offered while a server ABI exists.
    expect(screen.getByRole('button', { name: 'Events (1)' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Use custom ABI' }),
    ).not.toBeInTheDocument();

    // Keep only dismisses for this session: the banner stays hidden across
    // tab switches while the stored paste remains untouched.
    await user.click(within(banner).getByRole('button', { name: 'Keep' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Events (1)' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(localStorage.getItem(CUSTOM_ABI_STORAGE_KEY)).toBe(CUSTOM_ABI);
    expect(screen.getByTitle(/not used while a verified source is available/)).toBeInTheDocument();
  });

  it('Clear from the banner removes the stored paste and the banner', async () => {
    const user = userEvent.setup();
    localStorage.setItem(CUSTOM_ABI_STORAGE_KEY, CUSTOM_ABI);
    renderAt(`/chain/1/contract/${ADDRESS}`);

    const banner = await screen.findByRole('status');
    await user.click(within(banner).getByRole('button', { name: 'Clear custom ABI' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(localStorage.getItem(CUSTOM_ABI_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(CUSTOM_ABI_STORAGE_KEY)).toBeNull();
    expect(screen.queryByText('Custom ABI')).not.toBeInTheDocument();
    // The server ABI keeps driving the tabs after the paste is gone.
    expect(screen.getByRole('button', { name: 'Events (1)' })).toBeInTheDocument();
  });

  it('shows no banner when only the server ABI exists', async () => {
    renderAt(`/chain/1/contract/${ADDRESS}`);

    expect(
      await screen.findByRole('heading', { name: 'Contract Source Code' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/no longer used/)).not.toBeInTheDocument();
  });
});

describe('Contract view locked tabs and force refresh', () => {
  it('points the locked ABI and Interact tabs at the custom ABI panel', async () => {
    const user = userEvent.setup();
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    // ABI tab: unlock pointer instead of the bare "No ABI available".
    await user.click(await screen.findByRole('button', { name: 'ABI' }));
    expect(
      await screen.findByRole('heading', { name: 'Paste an ABI to unlock this tab' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open custom ABI panel' }),
    ).toBeInTheDocument();

    // The pointer focuses the panel's textarea (the panel sits below the
    // tab bar).
    await user.click(screen.getByRole('button', { name: 'Open custom ABI panel' }));
    expect(screen.getByLabelText('Custom ABI JSON')).toHaveFocus();

    // Interact tab: same pointer, and the interact panel itself is not
    // mounted with nothing to render.
    await user.click(screen.getByRole('button', { name: 'Interact' }));
    expect(
      screen.getByRole('heading', { name: 'Paste an ABI to unlock this tab' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('contract-interact')).not.toBeInTheDocument();
  });

  it('shows a success notice after a force refresh clears the cache', async () => {
    const user = userEvent.setup();
    renderAt(`/chain/1/contract/${ADDRESS}`);

    await user.click(await screen.findByRole('button', { name: '↻ Force Refresh' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Cache cleared — reloading source',
    );
  });

  it('explains the admin-token requirement when the clear-cache call answers 403', async () => {
    const user = userEvent.setup();
    vi.mocked(post).mockRejectedValueOnce(new ApiError('admin token required', 403));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    await user.click(await screen.findByRole('button', { name: '↻ Force Refresh' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Requires admin token — set it via ⚙️ RPC → Admin token. The server must have ADMIN_TOKEN configured.',
    );
  });

  it('shows a plain failure notice for non-403 clear-cache errors', async () => {
    const user = userEvent.setup();
    vi.mocked(post).mockRejectedValueOnce(new ApiError('boom', 500));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    await user.click(await screen.findByRole('button', { name: '↻ Force Refresh' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/Failed to clear cache/);
  });
});

describe('Contract view Events tab visibility', () => {
  it('keeps the Events tab and surfaces the unlock hint when a verified ABI has no events', async () => {
    const user = userEvent.setup();
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(noEventsSourceResponse));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    // Tab present without a count badge; the panel below keeps the full
    // indexing surface reachable.
    const eventsTab = await screen.findByRole('button', { name: 'Events' });
    expect(screen.queryByRole('button', { name: 'Events (1)' })).not.toBeInTheDocument();

    await user.click(eventsTab);

    expect(
      await screen.findByRole('heading', { name: 'Paste an ABI with event definitions' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/current ABI has no event definitions/)).toBeInTheDocument();
    // A usable server ABI means no custom ABI panel is rendered, so the
    // hint has no focus-jump button to offer.
    expect(
      screen.queryByRole('button', { name: 'Open custom ABI panel' }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('indexing-range-manager')).toBeInTheDocument();
    expect(screen.getByTestId('event-statistics')).toBeInTheDocument();
    expect(screen.getByTestId('event-table')).toBeInTheDocument();
  });

  it('offers the focus jump from the events hint when no ABI exists at all', async () => {
    const user = userEvent.setup();
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    await user.click(await screen.findByRole('button', { name: 'Events' }));

    expect(
      await screen.findByRole('heading', { name: 'Paste an ABI with event definitions' }),
    ).toBeInTheDocument();
    // The custom ABI panel's own copy also says "No ABI is available…", so
    // match the event-specific part of the hint message.
    expect(
      screen.getByText(/paste an ABI with event definitions to decode and filter events/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open custom ABI panel' }));
    expect(screen.getByLabelText('Custom ABI JSON')).toHaveFocus();
  });
});

describe('Contract view proxy implementation rendering', () => {
  const FACET_0 = '0xfac0000000000000000000000000000000000001';
  const FACET_1 = '0xfac1111111111111111111111111111111111111';
  const IMPL = '0x1110000000000000000000000000000000001111';

  const implementationContract = (address: string, name: string) => ({
    chainId: 1,
    address,
    name,
    sourceCode: 'pragma solidity ^0.8.20;',
    abi: '[]',
    verificationStatus: 'verified',
    verificationSource: 'sourcify',
    lastChecked: '2026-01-01T00:00:00Z',
  });

  // Fresh-fetch diamond payload: Sourcify resolves the proxy to multiple
  // facets and the backend forwards the whole list.
  const diamondSourceResponse = {
    contractSource: {
      ...verifiedSourceResponse.contractSource,
      isProxy: true,
      proxyType: 'diamond' as const,
      implementationAddress: FACET_0,
      implementationAddresses: [FACET_0, FACET_1],
      implementationContract: implementationContract(FACET_0, 'DiamondCutFacet'),
    },
  };

  // Ordinary single-implementation proxy (no facet list from the cache).
  const singleProxySourceResponse = {
    contractSource: {
      ...verifiedSourceResponse.contractSource,
      isProxy: true,
      proxyType: 'transparent' as const,
      implementationAddress: IMPL,
      implementationContract: implementationContract(IMPL, 'ImplementationV1'),
    },
  };

  it('lists every diamond facet and warns which tabs show facet[0] only', async () => {
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(diamondSourceResponse));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    // Amber banner above the tab bar names the diamond limitation and the
    // one exception (Interact merges every facet's ABI).
    expect(
      await screen.findByText(
        'Diamond proxy — 2 facets. Source, ABI, Events and Storage below show facet[0] only; Interact merges every facet\'s ABI.',
      ),
    ).toBeInTheDocument();

    // The Facets row links every facet to its own contract page; facet[0]
    // keeps the implementation-name prefix it had as a plain link.
    expect(screen.getByText(`DiamondCutFacet (${FACET_0})`)).toBeInTheDocument();
    const facet1 = screen.getByRole('link', { name: new RegExp(FACET_1) });
    expect(facet1).toHaveAttribute('href', `/chain/1/contract/${FACET_1}`);

    // No single-Implementation row masquerading as the whole diamond (the
    // Implementation *toggle* in the tab bar still renders — scoped here
    // to the info card's label).
    expect(
      screen.queryByText('Implementation', { selector: 'span.label' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the single Implementation row and no banner for ordinary proxies', async () => {
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(singleProxySourceResponse));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    expect(
      await screen.findByText('Implementation', { selector: 'span.label' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: new RegExp(IMPL) })).toHaveAttribute(
      'href',
      `/chain/1/contract/${IMPL}`,
    );
    expect(screen.queryByText(/Diamond proxy/)).not.toBeInTheDocument();
    expect(screen.queryByText('Facets')).not.toBeInTheDocument();
  });
});

describe('Contract view unverified guidance', () => {
  it('deep-links unverified contracts to Sourcify with chain and address prefilled', async () => {
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    const link = await screen.findByRole('link', { name: /Verify at Sourcify ↗/ });
    expect(link).toHaveAttribute(
      'href',
      `https://verify.sourcify.dev/widget?chainId=1&address=${ADDRESS}`,
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // The loop closer: the hint points at the Force Refresh that bypasses
    // the backend's unverified cache immediately.
    expect(screen.getByText(/Force Refresh above pulls it in immediately/)).toBeInTheDocument();
  });

  it('offers no Sourcify guidance once the contract is verified', async () => {
    renderAt(`/chain/1/contract/${ADDRESS}`);

    await screen.findByText('TestToken');
    expect(
      screen.queryByRole('link', { name: /Verify at Sourcify ↗/ }),
    ).not.toBeInTheDocument();
  });
});

describe('Contract view backend-offline attribution', () => {
  it('attributes status-0 failures to the missing backend with a self-help path', async () => {
    vi.mocked(useContractSource).mockReturnValue(
      mockHookError(new ApiError('Backend not connected — indexed data unavailable', 0)).result,
    );
    renderAt(`/chain/1/contract/${ADDRESS}`);

    // Not the raw message: the offline state names the cause, the start
    // command, and the setup entry points.
    expect(await screen.findByText(/Backend offline — indexed data unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/npx my-block-explorer --port 8201/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry connection/ })).toBeInTheDocument();
    expect(screen.queryByText(/Error:/)).not.toBeInTheDocument();
  });

  it('keeps ordinary API errors on the plain error rendering', async () => {
    vi.mocked(useContractSource).mockReturnValue(mockHookError(new ApiError('boom', 500)).result);
    renderAt(`/chain/1/contract/${ADDRESS}`);

    expect(await screen.findByText(/Error:/)).toBeInTheDocument();
    expect(screen.getByText(/boom/)).toBeInTheDocument();
    expect(screen.queryByText(/Backend offline/)).not.toBeInTheDocument();
  });

  it('retries the connection and refetches the source once a backend answers', async () => {
    const { result, refetch } = mockHookError(
      new ApiError('Backend not connected — indexed data unavailable', 0),
    );
    vi.mocked(useContractSource).mockReturnValue(result);
    mockReconnect.mockResolvedValueOnce({ url: 'http://localhost:8201' });
    const user = userEvent.setup();
    renderAt(`/chain/1/contract/${ADDRESS}`);

    await user.click(await screen.findByRole('button', { name: /Retry connection/ }));

    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(mockReconnect).toHaveBeenCalledTimes(1);
  });

  it('does not refetch when the reconnect still finds no backend', async () => {
    const { result, refetch } = mockHookError(
      new ApiError('Backend not connected — indexed data unavailable', 0),
    );
    vi.mocked(useContractSource).mockReturnValue(result);
    mockReconnect.mockResolvedValueOnce(null);
    const user = userEvent.setup();
    renderAt(`/chain/1/contract/${ADDRESS}`);

    await user.click(await screen.findByRole('button', { name: /Retry connection/ }));

    await waitFor(() => expect(mockReconnect).toHaveBeenCalledTimes(1));
    expect(refetch).not.toHaveBeenCalled();
  });
});

describe('Contract view not-a-contract 404 (P1-2 / C-1)', () => {
  it('renders the dedicated state with the View-as-address link instead of the generic error card', async () => {
    vi.mocked(useContractSource).mockReturnValue(
      mockHookError(
        new ApiError(`${ADDRESS} is not a contract on this chain`, 404, 'not_a_contract'),
      ).result,
    );
    renderAt(`/chain/1/contract/${ADDRESS}`);

    // Dedicated state, not the raw error strip.
    expect(
      await screen.findByRole('heading', { name: 'This address is not a contract on this chain' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Error:/)).not.toBeInTheDocument();

    // The escape hatch: the address page where balances and transactions
    // live, plus the one-sentence explanation of both possible causes.
    const link = screen.getByRole('link', { name: /View as address/ });
    expect(link).toHaveAttribute('href', `/chain/1/address/${ADDRESS}`);
    expect(screen.getByText(/externally owned account \(EOA\)/)).toBeInTheDocument();
    expect(screen.getByText(/no on-chain code/)).toBeInTheDocument();

    // The contract surfaces stay hidden: there is no contract to show.
    expect(screen.queryByRole('button', { name: 'ABI' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Interact' })).not.toBeInTheDocument();
  });

  it('keeps a plain 404 (no not_a_contract code) on the generic error rendering', async () => {
    vi.mocked(useContractSource).mockReturnValue(
      mockHookError(new ApiError('not found', 404)).result,
    );
    renderAt(`/chain/1/contract/${ADDRESS}`);

    expect(await screen.findByText(/Error:/)).toBeInTheDocument();
    expect(
      screen.queryByText('This address is not a contract on this chain'),
    ).not.toBeInTheDocument();
  });
});

describe('Contract view proxy with unverified implementation (B2)', () => {
  const IMPL = '0x1110000000000000000000000000000000001111';

  // Proxy verified (its own ABI carries the Transfer event from the shared
  // verified fixture) while the implementation answers the way the backend
  // reports unverified contracts: empty source, abi '[]'.
  const proxyVerifiedImplUnverified = {
    contractSource: {
      ...verifiedSourceResponse.contractSource,
      name: 'TransparentProxy',
      isProxy: true,
      proxyType: 'transparent' as const,
      implementationAddress: IMPL,
      implementationContract: {
        chainId: 1,
        address: IMPL,
        sourceCode: '',
        abi: '[]',
        verificationStatus: 'unverified',
        verificationSource: 'none',
        lastChecked: '2026-01-01T00:00:00Z',
      },
    },
  };

  it('lands on the Events tab, not the locked Interact view', async () => {
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(proxyVerifiedImplUnverified));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    // Events is the default landing (always queryable), written to the URL
    // like any explicit tab choice; Interact is not auto-selected into its
    // locked state.
    expect(await screen.findByTestId('event-table')).toBeInTheDocument();
    expect(await screen.findByTestId('search-probe')).toHaveTextContent('tab=events');
    expect(screen.queryByTestId('contract-interact')).not.toBeInTheDocument();

    // The landing surface carries the implementation-tier copy (hint and
    // custom ABI panel note alike) — never the blanket "no ABI anywhere"
    // claim — and offers the way out.
    expect(screen.getAllByText(/Implementation not verified/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Switch to Proxy view' })).toBeInTheDocument();
    expect(screen.queryByText(/No ABI is available for this contract/)).not.toBeInTheDocument();
  });

  it('distinguishes the implementation tier on the locked ABI tab and switches to the Proxy view', async () => {
    const user = userEvent.setup();
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(proxyVerifiedImplUnverified));
    renderAt(`/chain/1/contract/${ADDRESS}?tab=abi`);

    expect(
      await screen.findByText(
        'Implementation not verified — paste its ABI, or switch to the Proxy view to use the proxy\'s own ABI.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No ABI is available for this contract/)).not.toBeInTheDocument();

    // One click on the hint reuses the proxy/impl toggle: the proxy's own
    // server ABI unlocks the tab without any pasting.
    await user.click(screen.getByRole('button', { name: 'Switch to Proxy view' }));
    expect(await screen.findByRole('heading', { name: 'Proxy Contract ABI' })).toBeInTheDocument();
    expect(screen.getByText(/"type": "event"/)).toBeInTheDocument();
    expect(screen.queryByText(/Implementation not verified/)).not.toBeInTheDocument();
  });

  it('unlocks Interact the same way from its tier copy', async () => {
    const user = userEvent.setup();
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(proxyVerifiedImplUnverified));
    renderAt(`/chain/1/contract/${ADDRESS}?tab=interact`);

    expect(
      await screen.findByText(
        'Implementation not verified — paste its ABI, or switch to the Proxy view to use the proxy\'s own ABI.',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Switch to Proxy view' }));
    expect(await screen.findByTestId('contract-interact')).toBeInTheDocument();
  });

  it('keeps the blanket no-ABI copy for a contract with no ABI anywhere', async () => {
    // Plain unverified contract: no proxy, so no second tier exists — the
    // original message must survive verbatim, without a switch button.
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
    renderAt(`/chain/1/contract/${ADDRESS}?tab=abi`);

    expect(
      await screen.findByText(
        'No ABI is available for this contract. Use the custom ABI panel below the tab bar to paste one.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch to Proxy view' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Implementation not verified/)).not.toBeInTheDocument();
  });
});

describe('Contract view custom ABI on the ABI tab (B3)', () => {
  it('renders the pasted ABI with its provenance annotation instead of the server []', async () => {
    const user = userEvent.setup();
    localStorage.setItem(CUSTOM_ABI_STORAGE_KEY, CUSTOM_ABI);
    // The real unverified payload answers abi '[]' — the exact shape that
    // used to render as a bare [] while the paste did all the work.
    vi.mocked(useContractSource).mockReturnValue(
      mockHookResult({
        contractSource: { ...unverifiedSourceResponse.contractSource, abi: '[]' },
      }),
    );
    renderAt(`/chain/1/contract/${ADDRESS}`);

    await user.click(await screen.findByRole('button', { name: 'ABI' }));

    // The paste itself (exactly as stored) renders, with the annotation
    // naming where it comes from.
    expect(await screen.findByText('Custom ABI (this browser)')).toBeInTheDocument();
    const viewer = screen.getByTestId('source-viewer');
    expect(viewer).toHaveTextContent('"type":"event"');
    expect(viewer).toHaveTextContent('"name":"Transfer"');
    expect(viewer.textContent).toBe(CUSTOM_ABI);
    // The server's empty placeholder never reaches the viewer.
    expect(viewer.textContent).not.toBe('[]');
  });

  it('renders the server ABI without the annotation when no paste is in effect', async () => {
    const user = userEvent.setup();
    renderAt(`/chain/1/contract/${ADDRESS}`);

    await user.click(await screen.findByRole('button', { name: 'ABI' }));

    expect(screen.queryByText('Custom ABI (this browser)')).not.toBeInTheDocument();
    expect(screen.getByTestId('source-viewer')).toHaveTextContent('"type": "event"');
  });
});

describe('Contract view creation gas honesty', () => {
  const creationResponse = (gasUsed: string) => ({
    found: true,
    creation: {
      txHash: '0xabc0000000000000000000000000000000000000000000000000000000000002',
      blockNumber: 42,
      creator: '0xabc0000000000000000000000000000000000003',
      timestamp: 1700000000,
      gasUsed,
      gasPrice: '1000000000',
    },
  });

  it('renders Unknown instead of a confident zero when creation gas was not recorded', async () => {
    vi.mocked(useContractCreation).mockReturnValue(mockHookResult(creationResponse('0')));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    // A deployment cannot cost 0 gas: the zero answers as data missing.
    const gasValue = await screen.findByText('Unknown');
    expect(gasValue).toHaveAttribute(
      'title',
      'Creation gas not recorded by the indexer',
    );
    expect(screen.queryByText(/0 gas/)).not.toBeInTheDocument();
  });

  it('formats a recorded creation gas normally', async () => {
    vi.mocked(useContractCreation).mockReturnValue(mockHookResult(creationResponse('21000')));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    expect(await screen.findByText('21,000 gas')).toBeInTheDocument();
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
  });
});

describe('Contract view verification source provenance', () => {
  it('names the Sourcify provenance with an explanatory tooltip', async () => {
    renderAt(`/chain/1/contract/${ADDRESS}`);

    const label = await screen.findByText('Sourcify — independent verification');
    expect(label).toHaveAttribute('title', expect.stringContaining('verify.sourcify.dev'));
    // The raw enum value no longer reads as the whole story.
    expect(screen.queryByText(/^sourcify$/)).not.toBeInTheDocument();
  });

  it('labels the Blockscan source cache as third-party', async () => {
    vi.mocked(useContractSource).mockReturnValue(
      mockHookResult({
        contractSource: { ...verifiedSourceResponse.contractSource, verificationSource: 'blockscan' },
      }),
    );
    renderAt(`/chain/1/contract/${ADDRESS}`);

    const label = await screen.findByText('Blockscan — third-party source cache');
    expect(label).toHaveAttribute('title', expect.stringContaining('vscode.blockscan.com'));
  });

  it('renders provenance values outside the friendly table as-is', async () => {
    // 'none' (unverified answer) has no friendly label: honesty over
    // invention — the raw value stays.
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    expect(await screen.findByText('none')).toBeInTheDocument();
  });
});

describe('Contract view history-aware back', () => {
  it('falls back to the address-page navigation on a fresh deep link', async () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const user = userEvent.setup();
    renderAt(`/chain/1/contract/${ADDRESS}`);

    await user.click(await screen.findByRole('button', { name: /← Back/ }));

    // No in-site history (jsdom: length 1, empty referrer): the browser
    // back must not fire.
    expect(backSpy).not.toHaveBeenCalled();
    backSpy.mockRestore();
  });

  it('uses the browser back when the tab carries in-site history', async () => {
    // Every in-app router push grows history.length; emulate one prior
    // entry so the heuristic sees real browsing behind the page.
    window.history.pushState({}, '', '/chain/1/blocks');
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const user = userEvent.setup();
    renderAt(`/chain/1/contract/${ADDRESS}`);

    await user.click(await screen.findByRole('button', { name: /← Back/ }));

    expect(backSpy).toHaveBeenCalledTimes(1);
    backSpy.mockRestore();
  });
});

describe('Contract view on-chain proxy detection', () => {
  // Detection targets: a plain implementation and a beacon contract. Both
  // are all-hex addresses whose viem checksum form is the identity (no
  // letters to case-fold), so link href assertions stay literal.
  const IMPL = '0x1110000000000000000000000000000000001111';
  const BEACON = '0xbea000000000000000000000000000000000bea0';
  // viem's checksum form of BEACON (letters do case-fold here): the
  // resolver passes checksummed addresses to readContract.
  const BEACON_CHECKSUM = '0xBea000000000000000000000000000000000BeA0';

  // A 32-byte storage value holding `address` (left-padded with zeros).
  const paddedSlotAddress = (address: string) =>
    `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
  const ZERO_SLOT = `0x${'0'.repeat(64)}`;

  // Non-proxy runtime bytecode (a plain solc prologue): every slot probe
  // answers zero unless a test says otherwise.
  const PLAIN_RUNTIME = '0x608060405234801561001157600080fd5b50';

  // Minimal structural stand-in for the viem PublicClient the probe uses;
  // each call is observable so tests can assert which probes fired.
  const rpcClientMock = (behavior: {
    code?: string;
    storageBySlot?: Record<string, string>;
    readContractResult?: string;
  }) => {
    const client = {
      getCode: vi.fn(async () => behavior.code ?? '0x'),
      getStorageAt: vi.fn(async ({ slot }: { slot: string }) =>
        behavior.storageBySlot?.[slot] ?? ZERO_SLOT,
      ),
      readContract: vi.fn(async () => behavior.readContractResult ?? '0x'),
    } as unknown as PublicClient;
    vi.mocked(createRpcClient).mockResolvedValue(client);
    return client;
  };

  beforeEach(() => {
    vi.mocked(createRpcClient).mockReset();
  });

  it('probes unverified contracts and links the EIP-1967 slot implementation', async () => {
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
    const client = rpcClientMock({
      code: PLAIN_RUNTIME,
      storageBySlot: { [EIP1967_IMPLEMENTATION_SLOT]: paddedSlotAddress(IMPL) },
    });
    renderAt(`/chain/1/contract/${ADDRESS}`);

    expect(await screen.findByRole('heading', { name: 'Proxy Detection' })).toBeInTheDocument();
    expect(screen.getByText('EIP-1967 Proxy')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: IMPL });
    expect(link).toHaveAttribute('href', `/chain/1/contract/${IMPL}`);
    // The method row names the concrete slot (pinned from the shared
    // constants, so a slot-constant regression fails here too).
    expect(
      screen.getByText(new RegExp(EIP1967_IMPLEMENTATION_SLOT.slice(2))),
    ).toBeInTheDocument();
    // The honest provenance footnote.
    expect(
      screen.getByText(/Detected on-chain via implementation storage slot — not verified source data/),
    ).toBeInTheDocument();
    // Only the first storage probe ran: the 1967 implementation slot hit,
    // so the EIP-1822 and beacon slots were never read.
    expect(client.getStorageAt).toHaveBeenCalledTimes(1);
  });

  it('answers EIP-1167 clones from bytecode alone without any storage probe', async () => {
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
    const cloneRuntime = `0x363d3d373d3d3d363d73${IMPL.slice(2)}5af43d82803e903d91602b57fd5bf3`;
    const client = rpcClientMock({ code: cloneRuntime });
    renderAt(`/chain/1/contract/${ADDRESS}`);

    expect(await screen.findByRole('heading', { name: 'Proxy Detection' })).toBeInTheDocument();
    expect(screen.getByText('Minimal (EIP-1167) Proxy')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: IMPL })).toHaveAttribute(
      'href',
      `/chain/1/contract/${IMPL}`,
    );
    expect(
      screen.getByText(/Detected on-chain via runtime bytecode pattern — not verified source data/),
    ).toBeInTheDocument();
    expect(client.getStorageAt).not.toHaveBeenCalled();
  });

  it('static-calls the beacon for the real implementation', async () => {
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
    const client = rpcClientMock({
      code: PLAIN_RUNTIME,
      storageBySlot: { [EIP1967_BEACON_SLOT]: paddedSlotAddress(BEACON) },
      readContractResult: IMPL,
    });
    renderAt(`/chain/1/contract/${ADDRESS}`);

    expect(await screen.findByText('Beacon (EIP-1967) Proxy')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: IMPL })).toHaveAttribute(
      'href',
      `/chain/1/contract/${IMPL}`,
    );
    // The static call targeted the beacon (checksummed by the slot
    // decoder), not the proxy itself.
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: BEACON_CHECKSUM, functionName: 'implementation' }),
    );
  });

  it('renders no card when every probe honestly answers nothing', async () => {
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
    // A live RPC answering "plain contract, zero slots": the probe ran
    // (all three slots read) but has nothing honest to show.
    const client = rpcClientMock({ code: PLAIN_RUNTIME });
    renderAt(`/chain/1/contract/${ADDRESS}`);

    expect(
      await screen.findByRole('heading', { name: 'Contract Information' }),
    ).toBeInTheDocument();
    expect(client.getStorageAt).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('heading', { name: 'Proxy Detection' })).not.toBeInTheDocument();
  });

  it('renders no card when no RPC client can be created', async () => {
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
    vi.mocked(createRpcClient).mockRejectedValueOnce(new Error('no rpc for chain'));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    // No card, no error strip — the page simply stays on its
    // server-provided content.
    expect(
      await screen.findByRole('heading', { name: 'Contract Information' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Proxy Detection' })).not.toBeInTheDocument();
    expect(screen.queryByText(/not verified source data/)).not.toBeInTheDocument();
  });

  it('never probes and renders unchanged when the server resolved the proxy', async () => {
    // Server-resolved transparent proxy (the same payload shape as the
    // proxy-rendering suite above): the implementation row comes from the
    // server and the on-chain probe must not even create a client.
    vi.mocked(useContractSource).mockReturnValue(
      mockHookResult({
        contractSource: {
          ...verifiedSourceResponse.contractSource,
          isProxy: true,
          proxyType: 'transparent' as const,
          implementationAddress: IMPL,
          implementationContract: {
            chainId: 1,
            address: IMPL,
            name: 'ImplementationV1',
            sourceCode: 'pragma solidity ^0.8.20;',
            abi: '[]',
            verificationStatus: 'verified',
            verificationSource: 'sourcify',
            lastChecked: '2026-01-01T00:00:00Z',
          },
        },
      }),
    );
    renderAt(`/chain/1/contract/${ADDRESS}`);

    expect(await screen.findByText('Implementation', { selector: 'span.label' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: new RegExp(IMPL) })).toHaveAttribute(
      'href',
      `/chain/1/contract/${IMPL}`,
    );
    // Byte-identical DOM: no detection card, and the probe never fired.
    expect(screen.queryByRole('heading', { name: 'Proxy Detection' })).not.toBeInTheDocument();
    expect(vi.mocked(createRpcClient)).not.toHaveBeenCalled();
  });

  it('never probes plain verified contracts either (no layout shift)', async () => {
    // beforeEach default: verified non-proxy source. The gate keys on the
    // verification verdict, not just on missing implementation fields.
    renderAt(`/chain/1/contract/${ADDRESS}`);

    expect(await screen.findByText('TestToken')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Proxy Detection' })).not.toBeInTheDocument();
    expect(vi.mocked(createRpcClient)).not.toHaveBeenCalled();
  });
});
