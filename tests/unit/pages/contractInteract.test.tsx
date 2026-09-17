// ContractInteract unit tests: rendered directly (no router — the tab panel
// has no routing deps) with real parseContractFunctionsUnified from
// '@/utils/contractInteraction' (nothing in that module is mocked). Covers
// the proxy/impl target selector on the function list + banner, and the
// abiOverride path that lights up Interact for unverified contracts.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ContractInteract } from '@/views/Contract/ContractInteract';
import type { ContractSource } from '@/views/Contract/types';

const PROXY_ADDRESS = '0xabc0000000000000000000000000000000000001';
const IMPL_ADDRESS = '0xabc0000000000000000000000000000000000002';

// Proxy-side ABI: the admin surface of e.g. a TransparentUpgradeableProxy.
const PROXY_ABI = JSON.stringify([
  {
    type: 'function',
    name: 'admin',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
]);

// Implementation ABI: a plain token surface.
const IMPL_ABI = JSON.stringify([
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
]);

const proxyContractSource: ContractSource = {
  chainId: 1,
  address: PROXY_ADDRESS,
  name: 'TokenProxy',
  sourceCode: '',
  abi: PROXY_ABI,
  verificationStatus: 'partial',
  verificationSource: 'sourcify',
  lastChecked: '2026-01-01T00:00:00Z',
  isProxy: true,
  proxyType: 'transparent',
  implementationAddress: IMPL_ADDRESS,
  implementationContract: {
    chainId: 1,
    address: IMPL_ADDRESS,
    name: 'Token',
    sourceCode: '',
    abi: IMPL_ABI,
    verificationStatus: 'verified',
    verificationSource: 'sourcify',
    lastChecked: '2026-01-01T00:00:00Z',
  },
};

function renderInteract(props: Partial<Parameters<typeof ContractInteract>[0]> = {}) {
  return render(
    <ContractInteract
      chainId={1}
      contractAddress={PROXY_ADDRESS}
      contractSource={proxyContractSource}
      {...props}
    />,
  );
}

describe('ContractInteract proxy target', () => {
  it('lists the proxy ABI\'s admin functions for target \'proxy\'', async () => {
    renderInteract({ contractTarget: 'proxy' });

    // Loading resolves asynchronously — first paint assertions use findBy*.
    expect(await screen.findByText('admin')).toBeInTheDocument();
    expect(screen.queryByText('transfer')).not.toBeInTheDocument();
    // The banner must reflect that the proxy itself is the interaction target.
    expect(
      screen.getByText('Interacting with the proxy contract itself (admin functions).'),
    ).toBeInTheDocument();
  });

  it('lists the implementation ABI\'s functions for target \'impl\'', async () => {
    renderInteract({ contractTarget: 'impl' });

    expect(await screen.findByText('transfer')).toBeInTheDocument();
    expect(screen.queryByText('admin')).not.toBeInTheDocument();
    expect(
      screen.getByText('Interacting with implementation contract via proxy address.'),
    ).toBeInTheDocument();
  });

  it('keeps the unified \'all\' list when no target is passed', async () => {
    renderInteract();

    // No target keeps the historical view: the unified list (impl functions
    // plus proxy-only admin functions) behind the 'all' source filter.
    expect(await screen.findByText('transfer')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(
      screen.getByText('Interacting with implementation contract via proxy address.'),
    ).toBeInTheDocument();
  });
});

describe('ContractInteract abiOverride', () => {
  it('renders functions from the override ABI on a contract with no server ABI', async () => {
    const unverified: ContractSource = {
      chainId: 1,
      address: PROXY_ADDRESS,
      sourceCode: '',
      abi: '',
      verificationStatus: 'unverified',
      verificationSource: 'unknown',
      lastChecked: '2026-01-01T00:00:00Z',
    };

    render(
      <ContractInteract
        chainId={1}
        contractAddress={PROXY_ADDRESS}
        contractSource={unverified}
        abiOverride={JSON.stringify([
          {
            type: 'function',
            name: 'owner',
            inputs: [],
            outputs: [{ name: '', type: 'address' }],
            stateMutability: 'view',
          },
        ])}
      />,
    );

    expect(await screen.findByText('owner')).toBeInTheDocument();
    expect(screen.queryByText('Contract ABI not available')).not.toBeInTheDocument();
  });

  it('still shows the fallback without any ABI at all', async () => {
    const unverified: ContractSource = {
      chainId: 1,
      address: PROXY_ADDRESS,
      sourceCode: '',
      abi: '',
      verificationStatus: 'unverified',
      verificationSource: 'unknown',
      lastChecked: '2026-01-01T00:00:00Z',
    };

    render(
      <ContractInteract
        chainId={1}
        contractAddress={PROXY_ADDRESS}
        contractSource={unverified}
      />,
    );

    expect(await screen.findByText('Contract ABI not available')).toBeInTheDocument();
  });
});
