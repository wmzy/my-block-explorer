/**
 * Route-parameter identity resync for view-local state.
 *
 * @native-router reuses a view component when only :chainId/:address change
 * (the Contract view documents this at views/Contract/index.tsx). Any hook
 * state that belongs to ONE contract/address must therefore be reset when the
 * identity changes, or it leaks into the next identity — the repo's established
 * pattern is the render-phase identityRef resync (PrivateNoteChip,
 * StorageExplorer, AbiListPanel's own `selected`). These tests pin the sites
 * that had been missed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, createRoutes } from '@native-router/react';

import { ContractInteract } from '@/views/Contract/ContractInteract';
import { AbiListPanel } from '@/views/Contract/AbiListPanel';
import { createRpcClient } from '@/utils/realTimeData';

vi.mock('@/utils/realTimeData', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/realTimeData')>();
  return { ...actual, createRpcClient: vi.fn() };
});

const NullView = () => null;
// The write path renders a TypedLink on success; the read path needs no route,
// but the address page's route table must exist for any TypedLink render.
const routes = createRoutes([
  { path: '/chain/:chainId/tx/:txHash', component: () => NullView },
  { path: '/chain/:chainId/contract/:address', component: () => NullView },
]);

const ABI = JSON.stringify([
  {
    type: 'function',
    name: 'name',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
]);

const ADDRESS_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ADDRESS_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const wrap = (node: React.ReactNode) =>
  render(
    <MemoryRouter routes={routes} initialEntries={[`/chain/1/contract/${ADDRESS_A}`]}>
      {node}
    </MemoryRouter>,
  );

describe('ContractInteract resets per-contract state on an address change', () => {
  beforeEach(() => {
    vi.mocked(createRpcClient).mockReset();
    vi.mocked(createRpcClient).mockResolvedValue({
      readContract: vi.fn().mockResolvedValue('Wrapped Ether'),
      simulateContract: vi.fn().mockResolvedValue({ result: 1n, request: {} }),
    } as unknown as Awaited<ReturnType<typeof createRpcClient>>);
  });

  it('does not render the previous contract result under the new contract', async () => {
    const { rerender } = wrap(
      <ContractInteract
        chainId={1}
        contractAddress={ADDRESS_A}
        contractSource={null}
        abiOverride={ABI}
      />,
    );

    // Expand the read form and run the query.
    fireEvent.click(await screen.findByRole('button', { name: /name/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));
    expect(await screen.findByText('Wrapped Ether')).toBeInTheDocument();

    // Route param change: same component instance, a different contract.
    await act(async () => {
      rerender(
        <MemoryRouter routes={routes} initialEntries={[`/chain/1/contract/${ADDRESS_B}`]}>
          <ContractInteract
            chainId={1}
            contractAddress={ADDRESS_B}
            contractSource={null}
            abiOverride={ABI}
          />
        </MemoryRouter>,
      );
    });

    // The previous contract's read answer must not appear for the new one.
    expect(screen.queryByText('Wrapped Ether')).not.toBeInTheDocument();
  });
});

describe('AbiListPanel resets its filter when the ABI changes', () => {
  const abiWith = (name: string) =>
    JSON.stringify([
      {
        type: 'function',
        name,
        inputs: [],
        outputs: [],
        stateMutability: 'view',
      },
    ]);

  it('clears the name filter so the new contract list is not silently hidden', async () => {
    const { rerender } = wrap(
      <AbiListPanel abi={JSON.parse(abiWith('transfer'))} rawJson={abiWith('transfer')} />,
    );

    const input = screen.getByLabelText('Filter ABI entries by name or type');
    fireEvent.change(input, { target: { value: 'transfer' } });
    expect(input).toHaveValue('transfer');

    // A different contract's ABI (no 'transfer' entry) arrives without a remount.
    await act(async () => {
      rerender(
        <MemoryRouter routes={routes} initialEntries={[`/chain/1/contract/${ADDRESS_B}`]}>
          <AbiListPanel abi={JSON.parse(abiWith('approve'))} rawJson={abiWith('approve')} />
        </MemoryRouter>,
      );
    });

    expect(screen.getByLabelText('Filter ABI entries by name or type')).toHaveValue('');
    // The new ABI's function is visible (a stale filter would hide it).
    expect(screen.getByText(/approve/)).toBeInTheDocument();
  });
});
