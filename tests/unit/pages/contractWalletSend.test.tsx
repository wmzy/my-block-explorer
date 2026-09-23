// Wallet-connected sending in the contract Interact tab: with an injected
// EIP-1193 provider, write forms offer a 'Send with wallet' action that
// broadcasts the SAME encoded calldata the simulate path builds; without
// one, the rendered output must be byte-identical to the pre-wallet UI.
// The provider is stubbed at the EIP-1193 boundary (request/on/
// removeListener), so the full chain guard (switch / 4902 add / rejection)
// and the send outcomes (hash link, quiet 4001, verbatim errors) are
// exercised against real explorer chain metadata.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, createRoutes } from '@native-router/react';
import { encodeErrorResult, encodeFunctionData, getAddress, numberToHex, parseAbi, parseEther } from 'viem';
import type { Abi, AbiFunction } from 'viem';

import { FunctionCallForm } from '@/views/Contract/FunctionCallForm';
import { ContractInteract } from '@/views/Contract/ContractInteract';
import type { EIP1193Provider } from '@/util/wallet';
import type { ContractSource } from '@/views/Contract/types';
import type { EnhancedContractFunction } from '@/utils/contractInteraction';

const SENDER = '0x7777000000000000000000000000000000000001';
const RECIPIENT = '0x1111111111111111111111111111111111111111';
const CONTRACT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TX_HASH = '0xabcd00000000000000000000000000000000000000000000000000000000beef';

// viem-unknown id (no custom registration exists in the test process):
// the chain cannot be described to a wallet for wallet_addEthereumChain.
const UNKNOWN_CHAIN_ID = 999_999_123;

const transferFunc: EnhancedContractFunction = {
  name: 'transfer',
  type: 'function',
  inputs: [
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  outputs: [],
  stateMutability: 'nonpayable',
  interactionType: 'write',
  source: 'impl',
};

const depositFunc: EnhancedContractFunction = {
  name: 'deposit',
  type: 'function',
  inputs: [],
  outputs: [],
  stateMutability: 'payable',
  interactionType: 'write',
  source: 'impl',
};

const ownerFunc: EnhancedContractFunction = {
  name: 'owner',
  type: 'function',
  inputs: [],
  outputs: [{ name: '', type: 'address' }],
  stateMutability: 'view',
  interactionType: 'read',
  source: 'impl',
};

// EIP-3326/3085 error shapes as real wallets throw them.
const userRejectedError = () =>
  Object.assign(new Error('User rejected the request.'), { code: 4001 });
const chainUnknownError = () =>
  Object.assign(new Error('Unrecognized chain ID.'), { code: 4902 });

type WalletScript = {
  chainId?: string;
  accounts?: string[];
  switchError?: Error;
  addError?: Error;
  sendError?: Error;
  txHash?: string;
};

type RequestArgs = { method: string; params?: unknown[] | Record<string, unknown> };

// EIP-1193 stub: every method is scriptable and every request is recorded
// so assertions can check the exact method sequence and params.
const makeWallet = (script: WalletScript = {}) => {
  const calls: RequestArgs[] = [];
  const request = async (args: RequestArgs): Promise<unknown> => {
    calls.push(args);
    switch (args.method) {
      case 'eth_chainId':
        return script.chainId ?? '0x1';
      case 'eth_requestAccounts':
        return script.accounts ?? [SENDER];
      case 'wallet_switchEthereumChain':
        if (script.switchError) throw script.switchError;
        return null;
      case 'wallet_addEthereumChain':
        if (script.addError) throw script.addError;
        return null;
      case 'eth_sendTransaction':
        if (script.sendError) throw script.sendError;
        return script.txHash ?? TX_HASH;
      default:
        return null;
    }
  };
  const on = vi.fn();
  const removeListener = vi.fn();
  const provider: EIP1193Provider = { request, on, removeListener };
  return { provider, calls, on, removeListener };
};

const NullView = () => null;
const routes = createRoutes([
  { path: '/chain/:chainId/tx/:txHash', component: () => NullView },
]);

// The tx-hash success link renders a TypedLink, so the form mounts inside
// a MemoryRouter (callTraceCard test pattern); the form itself has no
// other routing dependency.
function renderWriteForm(options: {
  provider?: EIP1193Provider | null;
  func?: EnhancedContractFunction;
  chainId?: number;
  abi?: Abi;
} = {}) {
  const func = options.func ?? transferFunc;
  const result = render(
    <MemoryRouter routes={routes} initialEntries={['/chain/1/contract/0xdeadbeef']}>
      <FunctionCallForm
        func={func}
        onCall={vi.fn()}
        results={{}}
        errors={{}}
        loadingStates={{}}
        chainId={options.chainId ?? 1}
        blockNumber=""
        contractAddress={CONTRACT}
        walletProvider={options.provider}
        abi={options.abi}
      />
    </MemoryRouter>,
  );
  // Function forms render collapsed; expand like a real user would.
  fireEvent.click(screen.getByRole('button', { name: new RegExp(func.name) }));
  return result;
}

const fillTransfer = (to: string, amount: string) => {
  fireEvent.change(screen.getByLabelText('to (address)'), { target: { value: to } });
  fireEvent.change(screen.getByLabelText('amount (uint256)'), { target: { value: amount } });
};

const transferAbi = (inputs: Array<{ name: string; type: string }>): AbiFunction[] => [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs,
    outputs: [],
  },
];

// The calldata a successful send must carry: identical bytes to what the
// simulate path would submit (single-entry ABI + viem encoder, the same
// construction src/utils/castCommand.ts uses).
const expectedTransferCalldata = (to: string, amount: string) =>
  encodeFunctionData({
    abi: transferAbi([
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ]),
    functionName: 'transfer',
    args: [to, amount],
  });

afterEach(() => {
  delete (window as unknown as { ethereum?: unknown }).ethereum;
});

describe('FunctionCallForm wallet send availability', () => {
  it('renders byte-identical output when no provider is present', () => {
    // Prop omitted = today's exact call shape; null = the value the hook
    // yields without window.ethereum. The two renders must agree byte for
    // byte, and neither may contain any wallet affordance.
    const first = renderWriteForm();
    const html = first.container.innerHTML;
    first.unmount();

    const second = renderWriteForm({ provider: null });
    expect(second.container.innerHTML).toBe(html);

    expect(screen.getByRole('button', { name: 'Simulate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy as cast' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy calldata' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send with wallet' })).not.toBeInTheDocument();
    expect(screen.queryByText('this explorer never sees your keys')).not.toBeInTheDocument();
    expect(screen.queryByText('Rejected in wallet')).not.toBeInTheDocument();
  });

  it('offers the send action and trust note only for write functions', () => {
    renderWriteForm({ provider: makeWallet().provider });

    expect(screen.getByRole('button', { name: 'Send with wallet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simulate' })).toBeInTheDocument();
    expect(
      screen.getByText('Sent from your wallet; this explorer never sees your keys.'),
    ).toBeInTheDocument();
  });

  it('keeps read functions wallet-free even with a provider present', () => {
    renderWriteForm({ provider: makeWallet().provider, func: ownerFunc });

    expect(screen.getByRole('button', { name: 'Query' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send with wallet' })).not.toBeInTheDocument();
    expect(screen.queryByText('never sees your keys')).not.toBeInTheDocument();
  });

  it('shares the simulate/cast validation — invalid args disable send with the field reason', () => {
    renderWriteForm({ provider: makeWallet().provider });

    fillTransfer('', '100');
    const send = screen.getByRole('button', { name: 'Send with wallet' });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute('title', 'to: required');
    // One source of truth: the cast actions carry the same verdict.
    expect(screen.getByRole('button', { name: 'Copy as cast' })).toBeDisabled();

    fillTransfer(RECIPIENT, '100');
    expect(screen.getByRole('button', { name: 'Send with wallet' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Copy as cast' })).toBeEnabled();
  });
});

describe('FunctionCallForm wallet send flow', () => {
  it('sends the same encoded calldata the simulate path builds and links the hash internally', async () => {
    const { provider, calls } = makeWallet();
    renderWriteForm({ provider });

    fillTransfer(RECIPIENT, '100');
    fireEvent.click(screen.getByRole('button', { name: 'Send with wallet' }));

    const link = await screen.findByRole('link');
    expect(link).toHaveAttribute('href', `/chain/1/tx/${TX_HASH}`);
    expect(await screen.findByText('Sent — transaction broadcast:')).toBeInTheDocument();

    // Exactly the pre-send dance EIP-1193 prescribes, nothing more.
    expect(calls.map(call => call.method)).toEqual([
      'eth_chainId',
      'eth_requestAccounts',
      'eth_sendTransaction',
    ]);
    const txParams = calls[2].params as Array<Record<string, unknown>>;
    expect(txParams).toEqual([
      { from: SENDER, to: CONTRACT, data: expectedTransferCalldata(RECIPIENT, '100') },
    ]);
    // No gas is passed — the wallet estimates, this explorer never guesses.
    expect(Object.keys(txParams[0])).toEqual(['from', 'to', 'data']);
  });

  it('carries the payable value field as the tx value in wei-hex', async () => {
    const { provider, calls } = makeWallet();
    renderWriteForm({ provider, func: depositFunc });

    fireEvent.change(screen.getByLabelText('Value (ETH)'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send with wallet' }));

    await screen.findByRole('link');
    const txParams = calls[2].params as Array<Record<string, unknown>>;
    expect(txParams[0].value).toBe(numberToHex(parseEther('0.5')));
  });

  it('switches the wallet when chains mismatch, then sends', async () => {
    const { provider, calls } = makeWallet({ chainId: '0x89' }); // Polygon
    renderWriteForm({ provider });

    fillTransfer(RECIPIENT, '100');
    fireEvent.click(screen.getByRole('button', { name: 'Send with wallet' }));

    expect(await screen.findByRole('link')).toHaveAttribute('href', `/chain/1/tx/${TX_HASH}`);
    expect(screen.getByText('Wallet switched to Ethereum.')).toBeInTheDocument();

    const switchCall = calls.find(call => call.method === 'wallet_switchEthereumChain');
    expect(switchCall?.params).toEqual([{ chainId: '0x1' }]);
    expect(calls.some(call => call.method === 'eth_sendTransaction')).toBe(true);
  });

  it('aborts when the switch is rejected, naming the chain the wallet stayed on', async () => {
    const { provider, calls } = makeWallet({
      chainId: '0x89',
      switchError: userRejectedError(),
    });
    renderWriteForm({ provider });

    fillTransfer(RECIPIENT, '100');
    fireEvent.click(screen.getByRole('button', { name: 'Send with wallet' }));

    expect(
      await screen.findByText('Rejected in wallet — wallet stayed on Polygon.'),
    ).toBeInTheDocument();
    expect(calls.some(call => call.method === 'eth_sendTransaction')).toBe(false);
    expect(screen.queryByText('Wallet send error:')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('adds the chain on 4902 with the explorer chain metadata, then sends', async () => {
    const { provider, calls } = makeWallet({
      chainId: '0x89',
      switchError: chainUnknownError(),
    });
    renderWriteForm({ provider });

    fillTransfer(RECIPIENT, '100');
    fireEvent.click(screen.getByRole('button', { name: 'Send with wallet' }));

    expect(await screen.findByRole('link')).toBeInTheDocument();
    expect(screen.getByText('Wallet switched to Ethereum.')).toBeInTheDocument();

    const addCall = calls.find(call => call.method === 'wallet_addEthereumChain');
    expect(addCall?.params).toEqual([
      {
        chainId: '0x1',
        chainName: 'Ethereum',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: expect.arrayContaining([expect.stringMatching(/^https:/)]),
      },
    ]);
    expect(calls.some(call => call.method === 'eth_sendTransaction')).toBe(true);
  });

  it('reports unknown_chain without fabricating an add payload', async () => {
    const { provider, calls } = makeWallet({ chainId: '0x89' });
    renderWriteForm({ provider, chainId: UNKNOWN_CHAIN_ID });

    fillTransfer(RECIPIENT, '100');
    fireEvent.click(screen.getByRole('button', { name: 'Send with wallet' }));

    expect(
      await screen.findByText(
        `Unknown chain to this wallet — add chainId ${UNKNOWN_CHAIN_ID} in the wallet and retry.`,
      ),
    ).toBeInTheDocument();
    // The registry cannot describe this chain, so no switch/add attempt
    // is made and nothing is broadcast.
    expect(calls.some(call => call.method === 'wallet_switchEthereumChain')).toBe(false);
    expect(calls.some(call => call.method === 'wallet_addEthereumChain')).toBe(false);
    expect(calls.some(call => call.method === 'eth_sendTransaction')).toBe(false);
  });

  it('keeps a send rejection quiet — no error card', async () => {
    const { provider } = makeWallet({ sendError: userRejectedError() });
    renderWriteForm({ provider });

    fillTransfer(RECIPIENT, '100');
    fireEvent.click(screen.getByRole('button', { name: 'Send with wallet' }));

    expect(await screen.findByText('Rejected in wallet')).toBeInTheDocument();
    expect(screen.queryByText('Wallet send error:')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('attributes other send errors with the provider message verbatim', async () => {
    const { provider } = makeWallet({
      sendError: new Error('execution reverted: insufficient allowance'),
    });
    renderWriteForm({ provider });

    fillTransfer(RECIPIENT, '100');
    fireEvent.click(screen.getByRole('button', { name: 'Send with wallet' }));

    expect(await screen.findByText('Wallet send error:')).toBeInTheDocument();
    expect(screen.getByText('execution reverted: insufficient allowance')).toBeInTheDocument();
    expect(screen.queryByText('Rejected in wallet')).not.toBeInTheDocument();
  });

  it('decodes a custom-error revert payload the wallet reports on send', async () => {
    // Wallets surface eth_estimateGas revert data on the send error's
    // `data` property; the form's ABI decodes it into the custom error.
    const sendAbi: Abi = parseAbi([
      'function transfer(address to, uint256 amount) returns (bool)',
      'error InsufficientAllowance(address spender, uint256 required)',
    ]);
    const revertData = encodeErrorResult({
      abi: sendAbi,
      errorName: 'InsufficientAllowance',
      args: [SENDER, 1000000n],
    });
    const { provider } = makeWallet({
      sendError: Object.assign(new Error('execution reverted'), { data: revertData }),
    });
    renderWriteForm({ provider, abi: sendAbi });

    fillTransfer(RECIPIENT, '100');
    fireEvent.click(screen.getByRole('button', { name: 'Send with wallet' }));

    expect(await screen.findByText('Wallet send error:')).toBeInTheDocument();
    // Decoded custom error leads: name plus checksummed address and
    // grouped-decimal amount (getByText normalizes the thin-space
    // grouping to plain spaces on the node side).
    expect(
      screen.getByText(
        `ContractFunctionReverted: InsufficientAllowance(${getAddress(SENDER)}, 1 000 000)`,
      ),
    ).toBeInTheDocument();
  });
});

describe('ContractInteract wallet wiring', () => {
  const WRITE_ABI = JSON.stringify([
    {
      type: 'function',
      name: 'pause',
      inputs: [],
      outputs: [],
      stateMutability: 'nonpayable',
    },
  ]);

  const writeSource: ContractSource = {
    chainId: 1,
    address: CONTRACT,
    name: 'Simple',
    sourceCode: '',
    abi: WRITE_ABI,
    verificationStatus: 'verified',
    verificationSource: 'sourcify',
    lastChecked: '2026-01-01T00:00:00Z',
  };

  it('hides every wallet affordance and keeps the old note without window.ethereum', async () => {
    render(
      <ContractInteract
        chainId={1}
        contractAddress={CONTRACT}
        contractSource={writeSource}
      />,
    );

    expect(await screen.findByText('pause')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Write functions are simulations only. To execute transactions, use a Web3 wallet.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /pause/ }));
    expect(screen.queryByRole('button', { name: 'Send with wallet' })).not.toBeInTheDocument();
  });

  it('detects window.ethereum once, offers send, and refreshes on provider events', async () => {
    const wallet = makeWallet();
    Object.defineProperty(window, 'ethereum', { value: wallet.provider, configurable: true });

    const { unmount } = render(
      <ContractInteract
        chainId={1}
        contractAddress={CONTRACT}
        contractSource={writeSource}
      />,
    );

    expect(await screen.findByText('pause')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Write functions simulate locally — or send them from your wallet below. This explorer never sees your keys.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /pause/ }));
    expect(screen.getByRole('button', { name: 'Send with wallet' })).toBeInTheDocument();

    // Liveness wiring: both EIP-1193 events subscribed on mount, removed
    // on unmount — no polling loop exists to assert against.
    expect(wallet.on).toHaveBeenCalledWith('chainChanged', expect.any(Function));
    expect(wallet.on).toHaveBeenCalledWith('accountsChanged', expect.any(Function));

    unmount();
    expect(wallet.removeListener).toHaveBeenCalledWith('chainChanged', expect.any(Function));
    expect(wallet.removeListener).toHaveBeenCalledWith('accountsChanged', expect.any(Function));
  });
});
