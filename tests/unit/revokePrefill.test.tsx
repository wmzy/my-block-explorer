// Revoke-prefill wiring: the FunctionCallForm's initialArgs land in the
// argument inputs once on mount (user edits still win, submit carries the
// parsed prefill), and ContractInteract consumes a ?revoke= intent — the
// verified ABI's exact-signature function wins over the bundled standard
// fragment (with the honest standard-ABI note in that fallback), the
// per-kind args are pre-filled on the rendered form, and an unverified
// contract still gets the revoke surface via the fragment alone.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { FunctionCallForm } from '@/views/Contract/FunctionCallForm';
import { ContractInteract } from '@/views/Contract/ContractInteract';
import { simulateContract } from '@/utils/contractInteraction';
import type { EnhancedContractFunction } from '@/utils/contractInteraction';
import type { ContractSource } from '@/views/Contract/types';
import type { RevokeIntent } from '@/views/Contract/revokeIntent';

vi.mock('@/utils/contractInteraction', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/contractInteraction')>();
  return {
    ...actual,
    readContract: vi.fn(),
    simulateContract: vi.fn(),
  };
});

const CONTRACT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SPENDER = '0x1111111111111111111111111111111111111111';
const OPERATOR = '0x2222222222222222222222222222222222222222';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const erc20Intent: RevokeIntent = {
  kind: 'erc20',
  token: CONTRACT,
  spender: SPENDER,
};
const erc721Intent: RevokeIntent = {
  kind: 'erc721',
  token: CONTRACT,
  spender: SPENDER,
  tokenId: '77',
};
const erc1155Intent: RevokeIntent = {
  kind: 'erc1155',
  token: CONTRACT,
  spender: OPERATOR,
};

// MKR-style parameter names on purpose: same canonical signature as the
// standard fragment but distinguishable input labels, so the tests can
// tell the verified-ABI form from the fragment form apart.
const VERIFIED_APPROVE_ABI = JSON.stringify([
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'guy', type: 'address' },
      { name: 'wad', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
]);

const NO_APPROVE_ABI = JSON.stringify([
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

const simpleSource = (abi: string): ContractSource => ({
  chainId: 1,
  address: CONTRACT,
  name: 'Token',
  sourceCode: '',
  abi,
  verificationStatus: 'verified',
  verificationSource: 'sourcify',
  lastChecked: '2026-01-01T00:00:00Z',
});

const renderInteract = (props: Partial<Parameters<typeof ContractInteract>[0]> = {}) =>
  render(
    <ContractInteract
      chainId={1}
      contractAddress={CONTRACT}
      contractSource={simpleSource(VERIFIED_APPROVE_ABI)}
      {...props}
    />,
  );

beforeEach(() => {
  vi.mocked(simulateContract).mockReset();
  vi.mocked(global.fetch).mockClear();
});

describe('FunctionCallForm initialArgs prefill', () => {
  const approveWrite: EnhancedContractFunction = {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
    interactionType: 'write',
    source: 'impl',
  };

  const renderForm = (initialArgs?: readonly string[]) => {
    const onCall = vi.fn();
    render(
      <FunctionCallForm
        func={approveWrite}
        onCall={onCall}
        results={{}}
        errors={{}}
        loadingStates={{}}
        chainId={1}
        blockNumber=""
        contractAddress={CONTRACT}
        initialArgs={initialArgs}
        defaultExpanded
      />,
    );
    return onCall;
  };

  it('lands the prefill in the inputs on mount and submits the parsed values', () => {
    const onCall = renderForm([SPENDER, '0']);

    expect(screen.getByLabelText('spender (address)')).toHaveValue(SPENDER);
    expect(screen.getByLabelText('value (uint256)')).toHaveValue('0');

    fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));

    expect(onCall).toHaveBeenCalledWith(approveWrite, [SPENDER, '0'], [SPENDER, '0'], undefined, undefined, undefined);
  });

  it('keeps the user free to edit everything after the prefill', () => {
    const onCall = renderForm([SPENDER, '0']);

    fireEvent.change(screen.getByLabelText('value (uint256)'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));

    expect(onCall).toHaveBeenCalledWith(approveWrite, [SPENDER, '5'], [SPENDER, '5'], undefined, undefined, undefined);
  });

  it('pads a short prefill with empty inputs (trailing-empty-omit semantics intact)', () => {
    renderForm([SPENDER]);

    expect(screen.getByLabelText('spender (address)')).toHaveValue(SPENDER);
    expect(screen.getByLabelText('value (uint256)')).toHaveValue('');
    expect(screen.getByLabelText('value (uint256)')).toHaveAttribute(
      'placeholder',
      'optional — leave empty to omit',
    );
  });

  it('re-prefills when the payload itself changes, never on unrelated renders', () => {
    const onCall = vi.fn();
    const { rerender } = render(
      <FunctionCallForm
        func={approveWrite}
        onCall={onCall}
        results={{}}
        errors={{}}
        loadingStates={{}}
        chainId={1}
        blockNumber=""
        contractAddress={CONTRACT}
        initialArgs={[SPENDER, '0']}
        defaultExpanded
      />,
    );

    // User edits; a rerender with the SAME payload must not clobber it.
    fireEvent.change(screen.getByLabelText('value (uint256)'), { target: { value: '9' } });
    rerender(
      <FunctionCallForm
        func={approveWrite}
        onCall={onCall}
        results={{}}
        errors={{}}
        loadingStates={{}}
        chainId={1}
        blockNumber=""
        contractAddress={CONTRACT}
        initialArgs={[SPENDER, '0']}
        defaultExpanded
      />,
    );
    expect(screen.getByLabelText('value (uint256)')).toHaveValue('9');

    // A different payload (another intent landed on the same form) wins.
    rerender(
      <FunctionCallForm
        func={approveWrite}
        onCall={onCall}
        results={{}}
        errors={{}}
        loadingStates={{}}
        chainId={1}
        blockNumber=""
        contractAddress={CONTRACT}
        initialArgs={[OPERATOR, '0']}
        defaultExpanded
      />,
    );
    expect(screen.getByLabelText('spender (address)')).toHaveValue(OPERATOR);
    expect(screen.getByLabelText('value (uint256)')).toHaveValue('0');
  });
});

describe('ContractInteract revoke intent - function selection', () => {
  it('selects the verified ABI function when it carries the exact signature', async () => {
    vi.mocked(simulateContract).mockResolvedValue({ success: true, result: true });

    renderInteract({ revoke: erc20Intent });

    const card = await screen.findByTestId('revoke-intent-card');
    expect(card).toBeInTheDocument();
    expect(screen.getByTestId('revoke-verified-abi-note')).toBeInTheDocument();
    expect(screen.queryByTestId('revoke-standard-abi-note')).not.toBeInTheDocument();

    // The VERIFIED function's own parameter labels are prefilled (guy/wad,
    // not the fragment's spender/value). Scoped to the card: the regular
    // function list below renders the same signature's collapsed form.
    expect(within(card).getByLabelText('guy (address)')).toHaveValue(SPENDER);
    expect(within(card).getByLabelText('wad (uint256)')).toHaveValue('0');

    fireEvent.click(within(card).getByRole('button', { name: 'Simulate' }));

    await waitFor(() => expect(simulateContract).toHaveBeenCalledTimes(1));
    expect(vi.mocked(simulateContract).mock.calls[0][0]).toMatchObject({
      functionName: 'approve',
      args: [SPENDER, '0'],
      // Routed against the contract's own ABI, not a fragment.
      abi: VERIFIED_APPROVE_ABI,
    });
  });

  it('falls back to the standard fragment with the honest note when the ABI lacks the function', async () => {
    vi.mocked(simulateContract).mockResolvedValue({ success: true, result: true });

    renderInteract({ contractSource: simpleSource(NO_APPROVE_ABI), revoke: erc20Intent });

    expect(await screen.findByTestId('revoke-standard-abi-note')).toHaveTextContent(
      'Using the standard ERC-20 ABI',
    );
    expect(screen.queryByTestId('revoke-verified-abi-note')).not.toBeInTheDocument();

    const card = screen.getByTestId('revoke-intent-card');
    // Fragment form prefilled through the fragment's own labels.
    expect(within(card).getByLabelText('spender (address)')).toHaveValue(SPENDER);
    expect(within(card).getByLabelText('value (uint256)')).toHaveValue('0');

    fireEvent.click(within(card).getByRole('button', { name: 'Simulate' }));

    await waitFor(() => expect(simulateContract).toHaveBeenCalledTimes(1));
    const callArgs = vi.mocked(simulateContract).mock.calls[0][0];
    expect(callArgs).toMatchObject({ functionName: 'approve', args: [SPENDER, '0'] });
    // The routed ABI is the fragment — it names approve, and it is NOT the
    // contract's (function-less) verified ABI.
    expect(callArgs.abi).toContain('approve');
    expect(callArgs.abi).not.toBe(NO_APPROVE_ABI);
  });

  it('prefills erc721 as approve(zeroAddress, tokenId) with the single-token note', async () => {
    renderInteract({ contractSource: simpleSource(NO_APPROVE_ABI), revoke: erc721Intent });

    const card = await screen.findByTestId('revoke-intent-card');
    expect(card).toHaveTextContent('Revoke ERC-721 approval');
    expect(card).toHaveTextContent('token #77 only');

    expect(within(card).getByLabelText('to (address)')).toHaveValue(ZERO_ADDRESS);
    expect(within(card).getByLabelText('tokenId (uint256)')).toHaveValue('77');
  });

  it('prefills erc1155 as setApprovalForAll(operator, false)', async () => {
    renderInteract({ contractSource: simpleSource(NO_APPROVE_ABI), revoke: erc1155Intent });

    const card = await screen.findByTestId('revoke-intent-card');
    expect(card).toHaveTextContent('Revoke ERC-1155 approval');

    expect(within(card).getByLabelText('operator (address)')).toHaveValue(OPERATOR);
    expect(within(card).getByLabelText('approved (bool)')).toHaveValue('false');
  });

  it('offers the fragment revoke even with no ABI at all, and says what is missing', async () => {
    renderInteract({ contractSource: null, revoke: erc20Intent });

    expect(await screen.findByTestId('revoke-standard-abi-note')).toBeInTheDocument();
    expect(within(screen.getByTestId('revoke-intent-card')).getByLabelText('spender (address)')).toHaveValue(SPENDER);
    expect(
      screen.getByText(/only the revoke action above is offered here/),
    ).toBeInTheDocument();
  });

  it('renders an honest unavailable state for an intent that cannot map to a call', async () => {
    // A structurally-typed but invalid intent (bad token address) —
    // decodeRevokeIntent would never emit this from a URL, so this pins
    // the defensive branch.
    const broken: RevokeIntent = { kind: 'erc20', token: 'not-an-address', spender: SPENDER };

    renderInteract({ revoke: broken });

    expect(await screen.findByTestId('revoke-unavailable')).toHaveTextContent(
      'does not describe a revocable approval',
    );
    // The regular panel still renders behind it: the verified function
    // list keeps its collapsed approve form.
    expect(screen.getAllByText('approve').length).toBeGreaterThan(0);
  });

  it('renders no revoke surface without an intent', async () => {
    renderInteract();

    expect(await screen.findByText('approve')).toBeInTheDocument();
    expect(screen.queryByTestId('revoke-intent-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('revoke-unavailable')).not.toBeInTheDocument();
  });
});
