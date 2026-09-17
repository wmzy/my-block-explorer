// Contract view smoke tests: the view rendered under a minimal native-router
// harness (the route table Wave 4 wires will mount the same two C5 paths —
// /contract/:address and its /events subpath — onto this view). Services
// and network-adjacent children are mocked; assertions cover the header +
// info card + tab bar, the unsupported-chain branch, the /events default
// tab, the ?tab= write path, and the chain-switch navigation. Router view
// commits resolve asynchronously, so first paint assertions use findBy*.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, View, createRoutes, useSearchParams } from '@native-router/react';

import Contract from '@/views/Contract';
import {
  useContractCreation,
  useContractSource,
  useStorageLayout,
} from '@/services/contracts';

vi.mock('@/services/contracts', () => ({
  useContractSource: vi.fn(),
  useContractCreation: vi.fn(),
  useStorageLayout: vi.fn(),
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

vi.mock('@/util/http', () => ({
  get: vi.fn(async () => ({ ides: [] })),
  post: vi.fn(async () => ({})),
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

  it('renders the unsupported-chain error branch', async () => {
    renderAt('/chain/1234567/contract/0xdead');

    expect(await screen.findByText(/Unsupported chain ID/)).toBeInTheDocument();
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
    // No Events tab without any ABI to decode logs with, and Apply stays
    // disabled until something is pasted.
    expect(screen.queryByRole('button', { name: /^Events/ })).not.toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: /^Events/ })).not.toBeInTheDocument();
    expect(sessionStorage.getItem(CUSTOM_ABI_STORAGE_KEY)).toBeNull();
  });

  it('unlocks Events and hands the raw ABI to Interact after Apply', async () => {
    const user = userEvent.setup();
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    fireEvent.change(await screen.findByLabelText('Custom ABI JSON'), {
      target: { value: CUSTOM_ABI },
    });
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    // Badge appears in the tab bar and the raw string is persisted.
    expect(await screen.findByText('Custom ABI')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Events (1)' })).toBeInTheDocument();
    expect(sessionStorage.getItem(CUSTOM_ABI_STORAGE_KEY)).toBe(CUSTOM_ABI);

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
    sessionStorage.setItem(CUSTOM_ABI_STORAGE_KEY, CUSTOM_ABI);
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    // Lazy-initialised from sessionStorage without any typing.
    expect(await screen.findByRole('button', { name: 'Events (1)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Custom ABI JSON')).toHaveValue(CUSTOM_ABI);

    await user.click(screen.getByRole('button', { name: 'Clear custom ABI' }));

    expect(screen.queryByRole('button', { name: /^Events/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Custom ABI')).not.toBeInTheDocument();
    expect(sessionStorage.getItem(CUSTOM_ABI_STORAGE_KEY)).toBeNull();
    expect(screen.getByLabelText('Custom ABI JSON')).toHaveValue('');
  });
});
