// Diamond facet ABI merge tests: the pure mergeFacetAbis helper (dedup,
// conflict annotation, unavailability) and the rendered ContractInteract
// diamond path (extra facets fetched, merged into the list and call
// routing, honest notes when facets contribute nothing).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { ContractInteract, mergeFacetAbis } from '@/views/Contract/ContractInteract';
import { readContract } from '@/utils/contractInteraction';
import type { ContractSource } from '@/views/Contract/types';

vi.mock('@/utils/contractInteraction', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/contractInteraction')>();
  return {
    ...actual,
    readContract: vi.fn(),
    simulateContract: vi.fn(),
  };
});

vi.mock('@/services/contracts', () => ({
  fetchContractAbi: vi.fn(),
}));

import { fetchContractAbi } from '@/services/contracts';

const DIAMOND = '0xd1a000000000000000000000000000000000001';
const FACET_0 = '0xfac0000000000000000000000000000000000001';
const FACET_1 = '0xfac1111111111111111111111111111111111111';

const functionEntry = (
  name: string,
  inputs: Array<{ name: string; type: string }> = [],
): Record<string, unknown> => ({
  type: 'function',
  name,
  inputs,
  outputs: [],
  stateMutability: inputs.length > 0 ? 'nonpayable' : 'view',
});

const FACET_0_ABI = JSON.stringify([
  functionEntry('transfer', [
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ]),
  functionEntry('shared'),
  { type: 'event', name: 'Transfer', inputs: [] },
]);

const FACET_1_ABI = JSON.stringify([
  { ...functionEntry('mint', [{ name: 'tokens', type: 'uint256' }]), stateMutability: 'view' },
  functionEntry('shared'),
  { type: 'event', name: 'Transfer', inputs: [] },
]);

const PROXY_ABI = JSON.stringify([functionEntry('facets')]);

const diamondSource: ContractSource = {
  chainId: 1,
  address: DIAMOND,
  name: 'Diamond',
  sourceCode: '',
  abi: PROXY_ABI,
  verificationStatus: 'verified',
  verificationSource: 'sourcify',
  lastChecked: '2026-01-01T00:00:00Z',
  isProxy: true,
  proxyType: 'diamond',
  implementationAddress: FACET_0,
  implementationAddresses: [FACET_0, FACET_1],
  implementationContract: {
    chainId: 1,
    address: FACET_0,
    name: 'Facet0',
    sourceCode: '',
    abi: FACET_0_ABI,
    verificationStatus: 'verified',
    verificationSource: 'sourcify',
    lastChecked: '2026-01-01T00:00:00Z',
  },
};

const mockFacetAbi = (abi: string | null) =>
  vi
    .mocked(fetchContractAbi)
    .mockResolvedValue(abi === null ? undefined : ({ abi }));

beforeEach(() => {
  vi.mocked(readContract).mockReset();
  vi.mocked(fetchContractAbi).mockReset();
  vi.mocked(global.fetch).mockClear();
});

describe('mergeFacetAbis pure merge', () => {
  it('appends unique facet functions after facet[0] and keeps the first definition of shared signatures', () => {
    const merge = mergeFacetAbis(FACET_0_ABI, [{ address: FACET_1, abi: FACET_1_ABI }]);

    expect(merge.unavailable).toEqual([]);
    // 'shared()' exists in both facets: the facet[0] entry wins, the later
    // facet's copy is dropped and named.
    expect(merge.skippedSignatures).toEqual(['shared()']);
    const entries = JSON.parse(merge.merged ?? '[]') as Array<{ name?: string }>;
    const names = entries.map(entry => entry.name);
    expect(names.filter(name => name === 'shared')).toHaveLength(1);
    expect(names).toContain('transfer');
    expect(names).toContain('mint');
    // Duplicated events across facets are silently deduped, not annotated.
    expect(entries.filter(entry => entry.name === 'Transfer')).toHaveLength(1);
  });

  it('keeps facet[0] as the winner even when extras carry the conflict', () => {
    // Facet[1] redefines transfer(address,uint256): the facet[0] entry
    // survives verbatim.
    const conflicting = JSON.stringify([
      functionEntry('transfer', [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ]),
    ]);
    const merge = mergeFacetAbis(FACET_0_ABI, [{ address: FACET_1, abi: conflicting }]);

    expect(merge.skippedSignatures).toEqual(['transfer(address,uint256)']);
    const entries = JSON.parse(merge.merged ?? '[]') as Array<{ name?: string; type?: string }>;
    // facet[0]'s transfer(address,uint256) is untouched.
    expect(
      entries.filter(entry => entry.type === 'function' && entry.name === 'transfer'),
    ).toHaveLength(1);
  });

  it('marks facets whose ABI never arrived as unavailable', () => {
    const merge = mergeFacetAbis(FACET_0_ABI, [
      { address: FACET_1, abi: null },
      { address: DIAMOND, abi: 'not json' },
    ]);

    expect(merge.unavailable).toEqual([FACET_1, DIAMOND]);
    expect(merge.skippedSignatures).toEqual([]);
  });

  it('answers undefined only when nothing contributed', () => {
    expect(mergeFacetAbis(undefined, []).merged).toBeUndefined();
    // A verified-but-empty facet[0] keeps the old single-impl semantics.
    expect(mergeFacetAbis('[]', []).merged).toBe('[]');
    // Extras alone can build the surface.
    expect(mergeFacetAbis(undefined, [{ address: FACET_1, abi: FACET_1_ABI }]).merged).toBe(
      FACET_1_ABI,
    );
  });
});

describe('ContractInteract diamond facet merge', () => {
  const expandFunction = (name: string | RegExp) => {
    fireEvent.click(screen.getByRole('button', { name }));
  };

  it('lists functions from every facet and routes calls through the merged ABI', async () => {
    mockFacetAbi(FACET_1_ABI);
    vi.mocked(readContract).mockResolvedValue({ success: true, result: true });

    render(
      <ContractInteract
        chainId={1}
        contractAddress={DIAMOND}
        contractSource={diamondSource}
        contractTarget="impl"
      />,
    );

    // Facet[0] + facet[1] functions coexist in the list (facet[1]'s
    // functions appear after the async facet ABI fetch + re-parse).
    expect(await screen.findByText('transfer')).toBeInTheDocument();
    expect(await screen.findByText('mint')).toBeInTheDocument();
    // Shared signature appears exactly once.
    expect(screen.getAllByText('shared')).toHaveLength(1);
    // The banner names the diamond merge.
    expect(
      screen.getByText(/the function list merges every facet\u2019s ABI/),
    ).toBeInTheDocument();
    // The conflict note names the dropped duplicate.
    expect(screen.getByRole('status')).toHaveTextContent(
      'Shared function signatures kept from the first facet: shared().',
    );

    expandFunction(/mint/);
    fireEvent.change(screen.getByLabelText('tokens (uint256)'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    await waitFor(() => expect(readContract).toHaveBeenCalledTimes(1));
    const abiArg = vi.mocked(readContract).mock.calls[0][0].abi as string;
    const names = (JSON.parse(abiArg) as Array<{ name?: string }>).map(entry => entry.name);
    expect(names).toContain('mint');
    expect(names).toContain('transfer');
  });

  it('names facets whose ABI is unavailable instead of silently narrowing the surface', async () => {
    mockFacetAbi(null);
    // facet[1]'s fetch rejects: the note names it.
    vi.mocked(fetchContractAbi).mockRejectedValue(new Error('boom'));

    render(
      <ContractInteract
        chainId={1}
        contractAddress={DIAMOND}
        contractSource={diamondSource}
        contractTarget="impl"
      />,
    );

    expect(await screen.findByText('transfer')).toBeInTheDocument();
    expect(screen.queryByText('mint')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(`ABI unavailable for ${FACET_1}`);
  });

  it('keeps the plain implementation banner for ordinary proxies', async () => {
    const ordinary = {
      ...diamondSource,
      proxyType: 'transparent' as const,
      implementationAddresses: [FACET_0],
    };

    render(
      <ContractInteract
        chainId={1}
        contractAddress={DIAMOND}
        contractSource={ordinary}
        contractTarget="impl"
      />,
    );

    expect(
      await screen.findByText('Interacting with implementation contract via proxy address.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
