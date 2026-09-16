// Contract view smoke tests: the view rendered under a minimal native-router
// harness (the route table Wave 4 wires will mount the same two C5 paths —
// /contract/:address and its /events subpath — onto this view). Services
// and network-adjacent children are mocked; assertions cover the header +
// info card + tab bar, the unsupported-chain branch, the /events default
// tab, the ?tab= write path, and the chain-switch navigation. Router view
// commits resolve asynchronously, so first paint assertions use findBy*.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  return { default: () => React.createElement('div', { 'data-testid': 'event-table' }) };
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
