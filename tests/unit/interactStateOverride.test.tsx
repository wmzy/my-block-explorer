// Interact state-override wiring tests, end to end along the real seam:
// the FunctionCallForm disclosure (write forms only) parses the textarea on
// submit, an absent/empty override keeps the 6th onCall argument undefined,
// a valid one arrives as the converted viem structure, and invalid input
// renders the field-path sentences inline while blocking the simulate. One
// level deeper, the simulate request composer (simulateContract) omits the
// stateOverride key entirely when none is given (byte-identical wire) and
// forwards it verbatim when it is. The wallet broadcast path never sees
// the override — its transaction carries from/to/data only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, createRoutes } from '@native-router/react';

import { FunctionCallForm } from '@/views/Contract/FunctionCallForm';
import { simulateContract } from '@/utils/contractInteraction';
import { getRpcClient } from '@/utils/rpcClient';
import {
  parseStateOverrideInput,
  toViemStateOverride,
} from '@/views/Contract/stateOverrideInput';
import type { EIP1193Provider } from '@/util/wallet';
import type {
  ContractFunctionInput,
  EnhancedContractFunction,
} from '@/utils/contractInteraction';

const ADDR = '0x1111111111111111111111111111111111111111';
const SENDER = '0x3333333333333333333333333333333333333333';
const CONTRACT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TX_HASH = '0xabcd00000000000000000000000000000000000000000000000000000000beef';
const SLOT = '0x0000000000000000000000000000000000000000000000000000000000000001';
const VALUE = '0x0000000000000000000000000000000000000000000000000000000000000042';

const VALID_OVERRIDE_TEXT =
  `{"${ADDR}":{"balance":"0xde0b6b3a7640000",` +
  `"state":{"${SLOT}":"${VALUE}"}}}`;
const VALID_OVERRIDE_VIEM = [
  {
    address: ADDR,
    balance: 1000000000000000000n,
    state: [{ slot: SLOT, value: VALUE }],
  },
];

// The Interact panel talks to the chain through viem clients from
// getRpcClient; swap just that factory so the request composition stays
// real while the transport is a spy.
vi.mock('@/utils/rpcClient', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/rpcClient')>();
  return { ...actual, getRpcClient: vi.fn() };
});

type TestFunction = EnhancedContractFunction;

const makeWriteFunc = (
  inputs: ContractFunctionInput[] = [],
  name = 'deposit',
): TestFunction => ({
  name,
  type: 'function',
  inputs,
  outputs: [],
  stateMutability: 'nonpayable',
  interactionType: 'write',
  source: 'impl',
});

const makeReadFunc = (
  inputs: ContractFunctionInput[] = [],
  name = 'totalSupply',
): TestFunction => ({
  name,
  type: 'function',
  inputs,
  outputs: [],
  stateMutability: 'view',
  interactionType: 'read',
  source: 'impl',
});

type RequestArgs = { method: string; params?: unknown[] | Record<string, unknown> };

// EIP-1193 stub on the wallet boundary (contractWalletSend test pattern):
// chain matches, one account, a successful send — every request recorded.
const makeWallet = () => {
  const calls: RequestArgs[] = [];
  const request = async (args: RequestArgs): Promise<unknown> => {
    calls.push(args);
    switch (args.method) {
      case 'eth_chainId':
        return '0x1';
      case 'eth_requestAccounts':
        return [SENDER];
      case 'eth_sendTransaction':
        return TX_HASH;
      default:
        return null;
    }
  };
  const provider: EIP1193Provider = { request, on: vi.fn(), removeListener: vi.fn() };
  return { provider, calls };
};

const NullView = () => null;
const routes = createRoutes([{ path: '/chain/:chainId/tx/:txHash', component: () => NullView }]);

// The wallet-sent success card renders a TypedLink, so the form mounts
// inside a MemoryRouter (callTraceCard test pattern); the form itself has
// no other routing dependency.
function renderForm(func: TestFunction, withWallet = false) {
  const onCall = vi.fn();
  const wallet = makeWallet();
  render(
    <MemoryRouter routes={routes} initialEntries={['/chain/1/contract/0xtest']}>
      <FunctionCallForm
        func={func}
        onCall={onCall}
        results={{}}
        errors={{}}
        loadingStates={{}}
        chainId={1}
        blockNumber=""
        contractAddress={CONTRACT}
        walletProvider={withWallet ? wallet.provider : null}
      />
    </MemoryRouter>,
  );
  // Function forms render collapsed; expand like a real user would.
  fireEvent.click(screen.getByRole('button', { name: new RegExp(func.name) }));
  return { onCall, wallet };
}

const disclosureHeader = () =>
  screen.getByRole('button', { name: 'State overrides (advanced)' });

const openDisclosure = () => fireEvent.click(disclosureHeader());

const typeOverride = (text: string) =>
  fireEvent.change(screen.getByLabelText('Override map (JSON)'), {
    target: { value: text },
  });

const clickSimulate = () => fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));

describe('FunctionCallForm state-override disclosure', () => {
  it('offers the editor on write forms, collapsed by default', () => {
    renderForm(makeWriteFunc());
    expect(disclosureHeader()).toHaveAttribute('aria-expanded', 'false');
  });

  it('offers no editor on read forms', () => {
    renderForm(makeReadFunc());
    expect(
      screen.queryByRole('button', { name: 'State overrides (advanced)' }),
    ).not.toBeInTheDocument();
  });

  it('submits without an override argument when the textarea is empty', () => {
    const func = makeWriteFunc();
    const { onCall } = renderForm(func);

    openDisclosure();
    clickSimulate();

    expect(onCall).toHaveBeenCalledTimes(1);
    expect(onCall).toHaveBeenCalledWith(func, [], [], undefined, undefined, undefined);
  });

  it('carries a valid override into the onCall arguments as the converted structure', () => {
    const func = makeWriteFunc();
    const { onCall } = renderForm(func);

    openDisclosure();
    typeOverride(VALID_OVERRIDE_TEXT);
    clickSimulate();

    expect(onCall).toHaveBeenCalledTimes(1);
    expect(onCall).toHaveBeenCalledWith(func, [], [], undefined, undefined, [
      {
        address: ADDR,
        balance: 1000000000000000000n,
        state: [{ slot: SLOT, value: VALUE }],
      },
    ]);
  });

  it('drops an empty JSON object to undefined (byte-identical wire)', () => {
    const func = makeWriteFunc();
    const { onCall } = renderForm(func);

    openDisclosure();
    typeOverride('{}');
    clickSimulate();

    expect(onCall).toHaveBeenCalledWith(func, [], [], undefined, undefined, undefined);
  });

  it('blocks the simulate on invalid JSON with an inline error', async () => {
    const { onCall } = renderForm(makeWriteFunc());

    openDisclosure();
    typeOverride(`{"${ADDR}":{"balance":"0x1"}} trailing`);
    clickSimulate();

    expect(await screen.findByText(/stateOverride: not valid JSON \(/)).toBeInTheDocument();
    expect(onCall).not.toHaveBeenCalled();
  });

  it('blocks the simulate on an invalid field with the server sentence', async () => {
    const func = makeWriteFunc();
    const { onCall } = renderForm(func);

    openDisclosure();
    typeOverride(`{"${ADDR}":{"balance":"1"}}`);
    clickSimulate();

    expect(
      await screen.findByText(`${ADDR}.balance: must be a hex quantity like 0x1 (no leading zeros)`),
    ).toBeInTheDocument();
    expect(onCall).not.toHaveBeenCalled();

    // Correcting the map clears the error and releases the submit.
    typeOverride(`{"${ADDR}":{"balance":"0x1"}}`);
    clickSimulate();
    expect(
      screen.queryByText(`${ADDR}.balance: must be a hex quantity like 0x1 (no leading zeros)`),
    ).not.toBeInTheDocument();
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(onCall).toHaveBeenLastCalledWith(func, [], [], undefined, undefined, [
      { address: ADDR, balance: 1n },
    ]);
  });

  it('never carries the override into the wallet broadcast', async () => {
    const { onCall, wallet } = renderForm(makeWriteFunc(), true);

    openDisclosure();
    typeOverride(VALID_OVERRIDE_TEXT);
    fireEvent.click(screen.getByRole('button', { name: 'Send with wallet' }));

    await vi.waitFor(() =>
      expect(wallet.calls.some(call => call.method === 'eth_sendTransaction')).toBe(true),
    );
    const send = wallet.calls.find(call => call.method === 'eth_sendTransaction');
    if (send === undefined) throw new Error('eth_sendTransaction was never issued');
    // eth_sendTransaction shape only: from/to/data — no override surface.
    const tx = (send.params as Array<Record<string, unknown>>)[0];
    expect(Object.keys(tx).sort()).toEqual(['data', 'from', 'to']);
    expect(tx.from).toBe(SENDER);
    expect(tx.to).toBe(CONTRACT);
    // The simulate path (which owns overrides) never fired.
    expect(onCall).not.toHaveBeenCalled();
  });
});

describe('simulateContract request composition', () => {
  const simulateSpy = vi.fn().mockResolvedValue({ result: 1n, request: { gas: 21000n } });

  beforeEach(() => {
    simulateSpy.mockClear();
    vi.mocked(getRpcClient).mockReturnValue(
      { simulateContract: simulateSpy } as unknown as ReturnType<typeof getRpcClient>,
    );
  });

  it('omits the stateOverride key entirely when none is given (byte-identical wire)', async () => {
    await simulateContract({
      chainId: 1,
      contractAddress: CONTRACT,
      functionName: 'deposit',
      args: [],
      abi: '[]',
    });

    expect(simulateSpy).toHaveBeenCalledTimes(1);
    const request = simulateSpy.mock.calls[0][0];
    expect(Object.keys(request)).not.toContain('stateOverride');
    expect(request).toMatchObject({
      address: CONTRACT,
      functionName: 'deposit',
      args: [],
    });
  });

  it('forwards a parsed override verbatim into the simulate request', async () => {
    const parsed = parseStateOverrideInput(VALID_OVERRIDE_TEXT);
    if (!parsed.ok || parsed.value === undefined) throw new Error('fixture must parse');
    await simulateContract({
      chainId: 1,
      contractAddress: CONTRACT,
      functionName: 'deposit',
      args: [],
      abi: '[]',
      stateOverride: toViemStateOverride(parsed.value),
    });

    expect(simulateSpy).toHaveBeenCalledTimes(1);
    expect(simulateSpy.mock.calls[0][0]).toMatchObject({
      address: CONTRACT,
      functionName: 'deposit',
      stateOverride: VALID_OVERRIDE_VIEM,
    });
  });

  it('explicitly-undefined behaves exactly like omitted', async () => {
    await simulateContract({
      chainId: 1,
      contractAddress: CONTRACT,
      functionName: 'deposit',
      args: [],
      abi: '[]',
      stateOverride: undefined,
    });

    expect(Object.keys(simulateSpy.mock.calls[0][0])).not.toContain('stateOverride');
  });
});
