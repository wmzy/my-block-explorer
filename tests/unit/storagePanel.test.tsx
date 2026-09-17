// Storage tab unit tests: StoragePanel must fetch a layout for unverified
// contracts too (the backend falls back to evmole bytecode inference and
// reports it via the response envelope's `source`), show the honest
// unavailable card on true failures, and always read slot VALUES at the
// proxy address regardless of the proxy/impl toggle. The leaf read layer
// (SlotDisplay/StorageValue) is mocked so the real StorageLayoutView →
// StorageMember address passthrough is exercised end-to-end.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StoragePanel } from '@/views/Contract/StoragePanel';
import { useStorageLayout } from '@/services/contracts';
import type { ContractSource } from '@/views/Contract/types';

vi.mock('@/services/contracts', () => ({
  useStorageLayout: vi.fn(),
}));

vi.mock('@/components/storage/SlotDisplay', async () => {
  const React = await import('react');
  return {
    SlotDisplay: (props: { address: string; slot: string }) =>
      React.createElement('div', {
        'data-testid': 'slot-display',
        'data-address': props.address,
        'data-slot': props.slot,
      }),
  };
});

vi.mock('@/components/storage/StorageValue', async () => {
  const React = await import('react');
  return {
    StorageValue: (props: { address: string; path: string }) =>
      React.createElement('div', {
        'data-testid': 'storage-value',
        'data-address': props.address,
        'data-path': props.path,
      }),
  };
});

const PROXY = '0xabc0000000000000000000000000000000000001';
const IMPL = '0xabc0000000000000000000000000000000000002';

const layout = {
  storage: [
    { astId: 1, contract: 'TestToken', label: 'owner', offset: 0, slot: '0', type: 't_address' },
  ],
  types: { t_address: { encoding: 'inplace', label: 'address', numberOfBytes: '20' } },
};

const unverifiedSource: ContractSource = {
  chainId: 1,
  address: PROXY,
  sourceCode: '',
  abi: '[]',
  verificationStatus: 'unverified',
  verificationSource: 'unknown',
  lastChecked: '2026-01-01T00:00:00Z',
};

const proxySource: ContractSource = {
  chainId: 1,
  address: PROXY,
  sourceCode: 'pragma solidity ^0.8.0;',
  abi: '[]',
  verificationStatus: 'verified',
  verificationSource: 'manual',
  lastChecked: '2026-01-01T00:00:00Z',
  isProxy: true,
  implementationAddress: IMPL,
};

// The hook result shape shared by every mockReturnValue below.
const mockHookResult = (data: unknown, error?: unknown) =>
  ({ data, loading: false, error, refetch: vi.fn() }) as unknown as never;

function renderPanel(contractSource: ContractSource | null, contractTarget: 'proxy' | 'impl') {
  return render(
    <StoragePanel
      chainId={1}
      address={PROXY}
      contractSource={contractSource}
      contractTarget={contractTarget}
    />,
  );
}

beforeEach(() => {
  vi.mocked(useStorageLayout).mockReset();
});

describe('StoragePanel', () => {
  it('fetches and renders an evmole-inferred layout for an unverified contract with the amber notice', () => {
    vi.mocked(useStorageLayout).mockReturnValue(
      mockHookResult({ found: true, layout, source: 'evmole' }),
    );

    renderPanel(unverifiedSource, 'proxy');

    expect(vi.mocked(useStorageLayout)).toHaveBeenCalledWith(1, PROXY);
    expect(screen.getByText('Inferred from bytecode (unverified contract)')).toBeInTheDocument();
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(
      screen.queryByText('Storage layout is only available for verified contracts.'),
    ).not.toBeInTheDocument();
  });

  it('shows no notice and renders the layout when the source is fetcher (verified path)', () => {
    vi.mocked(useStorageLayout).mockReturnValue(
      mockHookResult({ found: true, layout, source: 'fetcher' }),
    );

    renderPanel({ ...proxySource, isProxy: undefined, implementationAddress: undefined }, 'proxy');

    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.queryByText('Inferred from bytecode (unverified contract)')).not.toBeInTheDocument();
  });

  it('shows the error card when the layout fetch fails', () => {
    vi.mocked(useStorageLayout).mockReturnValue(
      mockHookResult(undefined, new Error('layout fetch failed')),
    );

    renderPanel(unverifiedSource, 'proxy');

    expect(screen.getByText('layout fetch failed')).toBeInTheDocument();
    expect(screen.queryByText('owner')).not.toBeInTheDocument();
  });

  it('shows the unavailable card when the response has no layout (404)', () => {
    vi.mocked(useStorageLayout).mockReturnValue(mockHookResult({ found: false }));

    renderPanel(unverifiedSource, 'proxy');

    expect(screen.getByText('Storage layout not available for this contract.')).toBeInTheDocument();
  });

  it('reads slot values at the proxy address even when the layout targets the implementation', async () => {
    const user = userEvent.setup();
    vi.mocked(useStorageLayout).mockReturnValue(
      mockHookResult({ found: true, layout, source: 'fetcher' }),
    );

    renderPanel(proxySource, 'impl');

    // The layout itself is fetched at the implementation address...
    expect(vi.mocked(useStorageLayout)).toHaveBeenCalledWith(1, IMPL);
    // ...but slot values resolve to the proxy address in both toggle positions.
    const slotDisplays = screen.getAllByTestId('slot-display');
    expect(slotDisplays.length).toBeGreaterThan(0);
    for (const slot of slotDisplays) {
      expect(slot).toHaveAttribute('data-address', PROXY);
    }

    await user.click(screen.getByRole('button', { name: 'Load values' }));

    const storageValues = screen.getAllByTestId('storage-value');
    expect(storageValues.length).toBeGreaterThan(0);
    for (const value of storageValues) {
      expect(value).toHaveAttribute('data-address', PROXY);
    }
  });
});
