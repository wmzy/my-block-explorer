// ContractInteract unit tests: rendered directly (no router — the tab panel
// has no routing deps) with real parsing/filtering from
// '@/utils/contractInteraction' (only the readContract/simulateContract
// network boundary is mocked). Covers the proxy/impl target selector on the
// function list + banner, the abiOverride path that lights up Interact for
// unverified contracts (including contractSource=null), block-override
// validation (inline error, zero network calls), and the simulated-only tag
// on write result cards.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { ContractInteract } from '@/views/Contract/ContractInteract';
import { readContract, simulateContract } from '@/utils/contractInteraction';
import type { ContractSource } from '@/views/Contract/types';

vi.mock('@/utils/contractInteraction', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/contractInteraction')>();
  return {
    ...actual,
    readContract: vi.fn(),
    simulateContract: vi.fn(),
  };
});

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

// Standalone read surface: a no-arg view function submits without any
// argument inputs, so tests exercise exactly the block-override path.
const READ_ABI = JSON.stringify([
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
]);

// Standalone write surface: a no-arg nonpayable function.
const WRITE_ABI = JSON.stringify([
  {
    type: 'function',
    name: 'pause',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
]);

// Same-name read overloads whose raw-arg text can be identical ('5' is a
// valid uint256 and a valid string): only the signature fragment keeps
// their result slots apart.
const OVERLOAD_READ_ABI = JSON.stringify([
  {
    type: 'function',
    name: 'get',
    inputs: [{ name: 'slot', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'get',
    inputs: [{ name: 's', type: 'string' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
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

const simpleSource = (abi: string): ContractSource => ({
  chainId: 1,
  address: PROXY_ADDRESS,
  name: 'Simple',
  sourceCode: '',
  abi,
  verificationStatus: 'verified',
  verificationSource: 'sourcify',
  lastChecked: '2026-01-01T00:00:00Z',
});

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

beforeEach(() => {
  vi.mocked(readContract).mockReset();
  vi.mocked(simulateContract).mockReset();
  // tests/setup.ts installs global.fetch as a shared vi.fn(); clear it so
  // per-test call counts stay meaningful for the zero-network assertions.
  vi.mocked(global.fetch).mockClear();
});

// Function forms render inside a Collapsible that starts collapsed (its
// content is aria-hidden, so the submit button is inaccessible to role
// queries). Expand the header first, like a real user would.
const expandFunction = (name: string | RegExp) => {
  fireEvent.click(screen.getByRole('button', { name }));
};

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

  it('queries reads with contractSource null — the override alone is the ABI', async () => {
    vi.mocked(readContract).mockResolvedValue({ success: true, result: '0x1' });

    render(
      <ContractInteract
        chainId={1}
        contractAddress={PROXY_ADDRESS}
        contractSource={null}
        abiOverride={READ_ABI}
      />,
    );

    expect(await screen.findByText('owner')).toBeInTheDocument();
    expect(screen.queryByText('Contract source not available')).not.toBeInTheDocument();
    expect(screen.queryByText('Contract ABI not available')).not.toBeInTheDocument();

    expandFunction(/owner/);
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    await waitFor(() => expect(readContract).toHaveBeenCalledTimes(1));
    expect(vi.mocked(readContract).mock.calls[0][0]).toMatchObject({
      abi: READ_ABI,
      blockNumber: undefined,
    });
    expect(await screen.findByText('Result:')).toBeInTheDocument();
  });

  it('simulates writes with contractSource null and tags the result as simulated', async () => {
    vi.mocked(simulateContract).mockResolvedValue({
      success: true,
      result: true,
      gasUsed: 50_000n,
    });

    render(
      <ContractInteract
        chainId={1}
        contractAddress={PROXY_ADDRESS}
        contractSource={null}
        abiOverride={WRITE_ABI}
      />,
    );

    expect(await screen.findByText('pause')).toBeInTheDocument();

    expandFunction(/pause/);
    fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));

    await waitFor(() => expect(simulateContract).toHaveBeenCalledTimes(1));
    expect(vi.mocked(simulateContract).mock.calls[0][0]).toMatchObject({
      abi: WRITE_ABI,
    });
    expect(await screen.findByText('simulated — not sent')).toBeInTheDocument();
  });
});

describe('ContractInteract block override validation', () => {
  it('flags a non-numeric override inline and makes no network call', async () => {
    renderInteract({ contractSource: simpleSource(READ_ABI) });
    expect(await screen.findByText('owner')).toBeInTheDocument();

    const blockInput = screen.getByLabelText('Block number override');
    fireEvent.change(blockInput, { target: { value: '12ab' } });

    // Live field-level error the moment the input goes invalid.
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a block number');

    expandFunction(/owner/);
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    // No read, no raw fetch, and no misleading per-function 'Network error'.
    expect(readContract).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.queryByText('Network error')).not.toBeInTheDocument();
  });

  it('rejects named tags — the call path only understands decimal heights', async () => {
    renderInteract({ contractSource: simpleSource(READ_ABI) });
    expect(await screen.findByText('owner')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Block number override'), {
      target: { value: 'latest' },
    });
    expandFunction(/owner/);
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a block number');
    expect(readContract).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('routes a digits-only override as a bigint blockNumber', async () => {
    vi.mocked(readContract).mockResolvedValue({ success: true, result: '0x1' });

    renderInteract({ contractSource: simpleSource(READ_ABI) });
    expect(await screen.findByText('owner')).toBeInTheDocument();

    // Surrounding whitespace is tolerated: the trimmed value is validated.
    fireEvent.change(screen.getByLabelText('Block number override'), {
      target: { value: ' 19000000 ' },
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    expandFunction(/owner/);
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    await waitFor(() => expect(readContract).toHaveBeenCalledTimes(1));
    expect(vi.mocked(readContract).mock.calls[0][0]).toMatchObject({
      blockNumber: 19_000_000n,
      abi: READ_ABI,
    });
    // The result card renders: the form's key derivation still matches the
    // parent's when the override carries surrounding whitespace.
    expect(await screen.findByText('Result:')).toBeInTheDocument();
  });

  it('clears the inline error when the override is reset', async () => {
    renderInteract({ contractSource: simpleSource(READ_ABI) });
    expect(await screen.findByText('owner')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Block number override'), {
      target: { value: '0x12' },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a block number');

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Block number override')).toHaveValue('');
  });
});

describe('ContractInteract write simulation framing', () => {
  it('tags every write result card as simulated — not sent', async () => {
    vi.mocked(simulateContract).mockResolvedValue({
      success: true,
      result: true,
      gasUsed: 50_000n,
    });

    renderInteract({ contractSource: simpleSource(WRITE_ABI) });
    expect(await screen.findByText('pause')).toBeInTheDocument();

    expandFunction(/pause/);
    fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));

    expect(await screen.findByText('simulated — not sent')).toBeInTheDocument();
    // The global disclaimer stays too.
    expect(
      screen.getByText(/Write functions are simulations only\./),
    ).toBeInTheDocument();
  });

  it('keeps read result cards untagged', async () => {
    vi.mocked(readContract).mockResolvedValue({ success: true, result: '0x1' });

    renderInteract({ contractSource: simpleSource(READ_ABI) });
    expect(await screen.findByText('owner')).toBeInTheDocument();

    expandFunction(/owner/);
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    expect(await screen.findByText('Result:')).toBeInTheDocument();
    expect(screen.queryByText('simulated — not sent')).not.toBeInTheDocument();
  });
});

describe('ContractInteract same-name overloads', () => {
  it('keeps each overload\'s result in its own slot', async () => {
    // Distinct results per call: the uint256 overload answers first.
    vi.mocked(readContract)
      .mockResolvedValueOnce({ success: true, result: 'uint-result' })
      .mockResolvedValueOnce({ success: true, result: 'string-result' });

    renderInteract({ contractSource: simpleSource(OVERLOAD_READ_ABI) });
    expect((await screen.findAllByText('get')).length).toBe(2);

    // Both headers share the name 'get'; DOM order follows the ABI, so
    // index 0 is get(uint256) and index 1 is get(string).
    const headers = screen.getAllByRole('button', { name: /get/ });
    expect(headers).toHaveLength(2);

    // Query get(uint256) with '5'.
    fireEvent.click(headers[0]);
    fireEvent.change(screen.getByLabelText('slot (uint256)'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));
    expect(await screen.findByText('uint-result')).toBeInTheDocument();

    // Query get(string) with the identical raw arg '5' — under a
    // name-only key this would overwrite the sibling's slot.
    fireEvent.click(screen.getAllByRole('button', { name: /get/ })[1]);
    fireEvent.change(screen.getByLabelText('s (string)'), { target: { value: '5' } });
    const queryButtons = screen.getAllByRole('button', { name: 'Query' });
    expect(queryButtons).toHaveLength(2);
    fireEvent.click(queryButtons[1]);

    expect(await screen.findByText('string-result')).toBeInTheDocument();
    // The uint256 overload's result survived the second query.
    expect(screen.getByText('uint-result')).toBeInTheDocument();
    // Two separate result cards, not one shared slot.
    expect(screen.getAllByText('Result:')).toHaveLength(2);
  });
});
