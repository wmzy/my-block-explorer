// FunctionCallForm wiring tests: the pure parser's output actually drives
// the form — composite inputs submit as real JS arrays/tuples, invalid
// values render field-level inline errors (no submit), trailing inputs
// may be left empty only when the abi carries a same-name overload
// accepting the filled count (omitted from the call, hinted via
// placeholder), and any other empty input blocks the submit with a
// 'required' error.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { encodeFunctionData } from 'viem';
import type { Abi, AbiFunction } from 'viem';

import { FunctionCallForm } from '@/views/Contract/FunctionCallForm';
import { getDefaultRpcUrl } from '@/config/chains';
import type {
  ContractFunctionInput,
  EnhancedContractFunction,
} from '@/utils/contractInteraction';

const ADDR_A = '0x1111111111111111111111111111111111111111';
const ADDR_B = '0x2222222222222222222222222222222222222222';
const CONTRACT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const RPC_1 = getDefaultRpcUrl(1);

type TestFunction = EnhancedContractFunction;

const makeFunc = (inputs: ContractFunctionInput[], name = 'f'): TestFunction => ({
  name,
  type: 'function',
  inputs,
  outputs: [],
  stateMutability: 'view',
  interactionType: 'read',
  source: 'impl',
});

// Payable write surface: renders the Value (chain-native symbol) and From
// fields.
const makeWriteFunc = (inputs: ContractFunctionInput[], name = 'f'): TestFunction => ({
  name,
  type: 'function',
  inputs,
  outputs: [],
  stateMutability: 'payable',
  interactionType: 'write',
  source: 'impl',
});

function renderForm(
  func: TestFunction,
  options?: { contractAddress?: string; chainId?: number; abi?: Abi },
) {
  const onCall = vi.fn();
  render(
    <FunctionCallForm
      func={func}
      onCall={onCall}
      results={{}}
      errors={{}}
      loadingStates={{}}
      chainId={options?.chainId ?? 1}
      blockNumber=""
      contractAddress={options?.contractAddress}
      abi={options?.abi}
    />,
  );
  // Function forms render collapsed; expand like a real user would.
  fireEvent.click(screen.getByRole('button', { name: new RegExp(func.name) }));
  return onCall;
}

describe('FunctionCallForm composite arguments', () => {
  it('submits address[] input as a real array in both input syntaxes', () => {
    const func = makeFunc([{ name: 'addrs', type: 'address[]' }], 'batchSend');
    const onCall = renderForm(func);

    const field = screen.getByLabelText('addrs (address[])');
    fireEvent.change(field, { target: { value: `["${ADDR_A}","${ADDR_B}"]` } });
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    expect(onCall).toHaveBeenCalledWith(
      func,
      [[ADDR_A, ADDR_B]],
      [`["${ADDR_A}","${ADDR_B}"]`],
      undefined,
      undefined,
      undefined,
    );

    fireEvent.change(field, { target: { value: `${ADDR_A},${ADDR_B}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    expect(onCall).toHaveBeenLastCalledWith(
      func,
      [[ADDR_A, ADDR_B]],
      [`${ADDR_A},${ADDR_B}`],
      undefined,
      undefined,
      undefined,
    );
  });

  it('submits tuple input as a positional array', () => {
    const func = makeFunc(
      [
        {
          name: 'p',
          type: 'tuple',
          components: [
            { name: 'x', type: 'uint256' },
            { name: 'y', type: 'address' },
          ],
        },
      ],
      'move',
    );
    const onCall = renderForm(func);

    fireEvent.change(screen.getByLabelText('p (tuple)'), {
      target: { value: `5,${ADDR_A}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    expect(onCall).toHaveBeenCalledWith(
      func,
      [['5', ADDR_A]],
      [`5,${ADDR_A}`],
      undefined,
      undefined,
      undefined,
    );
  });

  it('renders the element-level error inline and blocks the submit', async () => {
    const onCall = renderForm(makeFunc([{ name: 'addrs', type: 'address[]' }], 'batchSend'));

    fireEvent.change(screen.getByLabelText('addrs (address[])'), {
      target: { value: `${ADDR_A},nope` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    expect(await screen.findByText('addrs[1]: invalid address')).toBeInTheDocument();
    expect(onCall).not.toHaveBeenCalled();
  });

  it('names the component inside tuple validation errors', async () => {
    const onCall = renderForm(
      makeFunc(
        [
          {
            name: 'p',
            type: 'tuple',
            components: [
              { name: 'x', type: 'uint256' },
              { name: 'y', type: 'address' },
            ],
          },
        ],
        'move',
      ),
    );

    fireEvent.change(screen.getByLabelText('p (tuple)'), {
      target: { value: '5,nope' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    expect(await screen.findByText('p.y: invalid address')).toBeInTheDocument();
    expect(onCall).not.toHaveBeenCalled();
  });

  it('clears the field error once the input is corrected', async () => {
    renderForm(makeFunc([{ name: 'to', type: 'address' }], 'claim'));

    const field = screen.getByLabelText('to (address)');
    fireEvent.change(field, { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));
    expect(await screen.findByText('to: invalid address')).toBeInTheDocument();

    fireEvent.change(field, { target: { value: ADDR_A } });
    expect(screen.queryByText('to: invalid address')).not.toBeInTheDocument();
  });
});

describe('FunctionCallForm trailing-optional rule', () => {
  // ERC-223-style overload family: the abi carries both the 2-input and
  // the 3-input transfer, so the form's third input is genuinely
  // omittable once two are filled.
  const transferAbi = [
    {
      type: 'function',
      name: 'transfer',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      outputs: [],
    },
    {
      type: 'function',
      name: 'transfer',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ],
      outputs: [],
    },
  ] satisfies Abi;

  const transfer3 = makeFunc(
    [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    'transfer',
  );

  it('omits an empty trailing input when the abi has the shorter overload', () => {
    const onCall = renderForm(transfer3, { abi: transferAbi });

    // All-empty start: nothing is omittable yet (a 0-argument transfer
    // does not exist); the affordance appears once two are filled.
    expect(screen.getByLabelText('data (bytes)')).toHaveAttribute('placeholder', 'Enter bytes');

    fireEvent.change(screen.getByLabelText('to (address)'), { target: { value: ADDR_A } });
    fireEvent.change(screen.getByLabelText('amount (uint256)'), { target: { value: '5' } });

    expect(screen.getByLabelText('data (bytes)')).toHaveAttribute(
      'placeholder',
      'optional — leave empty to omit',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    expect(onCall).toHaveBeenCalledWith(transfer3, [ADDR_A, '5'], [ADDR_A, '5', ''], undefined, undefined, undefined);
  });

  it('never promises omission while the filled count matches no overload', () => {
    renderForm(transfer3, { abi: transferAbi });

    // Only one input filled: a 1-argument transfer does not exist, so no
    // input is advertised as omittable.
    fireEvent.change(screen.getByLabelText('to (address)'), { target: { value: ADDR_A } });
    expect(screen.getByLabelText('amount (uint256)')).toHaveAttribute(
      'placeholder',
      'Enter uint256',
    );
    expect(screen.getByLabelText('data (bytes)')).toHaveAttribute('placeholder', 'Enter bytes');
  });

  it('does not advertise omission without an abi to consult', async () => {
    const func = makeFunc(
      [
        { name: 'owner', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      'setOwner',
    );
    renderForm(func);

    expect(screen.getByLabelText('owner (address)')).toHaveAttribute(
      'placeholder',
      'Enter address',
    );
    expect(screen.getByLabelText('amount (uint256)')).toHaveAttribute(
      'placeholder',
      'Enter uint256',
    );

    fireEvent.change(screen.getByLabelText('owner (address)'), {
      target: { value: ADDR_A },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    expect(await screen.findByText('amount: required')).toBeInTheDocument();
  });

  it('blocks an empty submit of a single-input function at the field level', async () => {
    // balanceOf(address): no shorter overload exists, so the empty
    // submit must never reach the encoder (which would either throw a
    // generic length mismatch or encode a wrong selector).
    const balanceOfAbi = [
      {
        type: 'function',
        name: 'balanceOf',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ] satisfies Abi;
    const balanceOf = makeFunc([{ name: 'account', type: 'address' }], 'balanceOf');
    const onCall = renderForm(balanceOf, {
      abi: balanceOfAbi,
      contractAddress: CONTRACT,
    });

    expect(screen.getByLabelText('account (address)')).toHaveAttribute(
      'placeholder',
      'Enter address',
    );
    // The cast/wallet consumers of the same encode are gated too: an
    // unencodable call must disable them instead of fabricating a
    // balanceOf() selector that does not exist on the contract.
    expect(screen.getByRole('button', { name: 'Copy as cast' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    expect(await screen.findByText('account: required')).toBeInTheDocument();
    expect(onCall).not.toHaveBeenCalled();
  });

  it('blocks a non-trailing empty input with a required error', async () => {
    const onCall = renderForm(transfer3, { abi: transferAbi });

    fireEvent.change(screen.getByLabelText('amount (uint256)'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    expect(await screen.findByText('to: required')).toBeInTheDocument();
    expect(onCall).not.toHaveBeenCalled();
  });
});

describe('FunctionCallForm from-address validation', () => {
  const func = makeWriteFunc([], 'deposit');

  const fromField = () => screen.getByPlaceholderText('0x...');

  it('flags a malformed From inline and blocks the simulate', async () => {
    const onCall = renderForm(func);

    fireEvent.change(fromField(), { target: { value: '0x123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));

    expect(await screen.findByText('invalid address')).toBeInTheDocument();
    expect(onCall).not.toHaveBeenCalled();

    // Correcting the field clears the error.
    fireEvent.change(fromField(), { target: { value: ADDR_A } });
    expect(screen.queryByText('invalid address')).not.toBeInTheDocument();
  });

  it('submits a valid From trimmed', () => {
    const onCall = renderForm(func);

    fireEvent.change(fromField(), { target: { value: `  ${ADDR_A}  ` } });
    fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));

    expect(onCall).toHaveBeenCalledWith(func, [], [], undefined, ADDR_A, undefined);
  });

  it('keeps From optional — empty submits as undefined', () => {
    const onCall = renderForm(func);

    fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));

    expect(onCall).toHaveBeenCalledWith(func, [], [], undefined, undefined, undefined);
  });
});

describe('FunctionCallForm chain-native value unit', () => {
  const func = makeWriteFunc([], 'deposit');

  it('labels the payable value field with the chain native symbol', () => {
    const onCall = vi.fn();
    render(
      <FunctionCallForm
        func={func}
        onCall={onCall}
        results={{}}
        errors={{}}
        loadingStates={{}}
        chainId={137}
        blockNumber=""
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /deposit/ }));

    // Polygon's native symbol (POL) drives the label — never a hardcoded
    // 'ETH' on a non-Ethereum chain.
    expect(screen.getByLabelText('Value (POL)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Value (ETH)')).not.toBeInTheDocument();
  });
});

describe('FunctionCallForm cast copy actions', () => {
  // userEvent.setup() swaps in its own clipboard stubs; stick to
  // fireEvent and stub the platform API directly (customAbiPanel test
  // pattern).
  const stubClipboard = (writeText?: (text: string) => Promise<void>) => {
    Object.defineProperty(navigator, 'clipboard', {
      value: writeText ? { writeText } : undefined,
      configurable: true,
    });
  };

  const castButton = () => screen.getByRole('button', { name: 'Copy as cast' });
  const calldataButton = () => screen.getByRole('button', { name: 'Copy calldata' });

  it('copies a runnable cast call command for the filled args', async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);
    const func = makeFunc([{ name: 'who', type: 'address' }], 'balanceOf');
    renderForm(func, { contractAddress: CONTRACT });

    fireEvent.change(screen.getByLabelText('who (address)'), { target: { value: ADDR_A } });
    fireEvent.click(castButton());

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(
      `cast call ${CONTRACT} "balanceOf(address)" ${ADDR_A} --rpc-url ${RPC_1}`,
    );
    expect(await screen.findByRole('button', { name: 'Copied ✓' })).toBeInTheDocument();
  });

  it('discloses the default-public-RPC caveat in the enabled tooltip', () => {
    renderForm(makeFunc([{ name: 'who', type: 'address' }], 'balanceOf'), {
      contractAddress: CONTRACT,
    });

    // The copy actions only enable once the call encodes — an empty
    // required arg would disable them with the field error instead.
    fireEvent.change(screen.getByLabelText('who (address)'), { target: { value: ADDR_A } });

    expect(castButton()).toHaveAttribute(
      'title',
      expect.stringContaining('uses the chain\'s default public RPC'),
    );
  });

  it('copies the send variant with the key placeholder for write functions', async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);
    const func = makeWriteFunc(
      [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      'transfer',
    );
    renderForm(func, { contractAddress: CONTRACT });

    fireEvent.change(screen.getByLabelText('to (address)'), { target: { value: ADDR_A } });
    fireEvent.change(screen.getByLabelText('amount (uint256)'), { target: { value: '100' } });
    fireEvent.click(castButton());

    expect(writeText).toHaveBeenCalledWith(
      `cast send ${CONTRACT} "transfer(address,uint256)" ${ADDR_A} 100 ` +
      `--rpc-url ${RPC_1} --private-key <ENTER_YOUR_KEY>`,
    );
  });

  it('switches to the encoded-calldata form for array args and copies the raw bytes', async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);
    const func = makeFunc([{ name: 'owners', type: 'address[]' }], 'getOwners');
    renderForm(func, { contractAddress: CONTRACT });

    fireEvent.change(screen.getByLabelText('owners (address[])'), {
      target: { value: `${ADDR_A},${ADDR_B}` },
    });
    fireEvent.click(castButton());

    const expectedAbi: AbiFunction[] = [
      {
        type: 'function',
        name: 'getOwners',
        stateMutability: 'view',
        inputs: [{ name: 'owners', type: 'address[]' }],
        outputs: [],
      },
    ];
    const expected = encodeFunctionData({
      abi: expectedAbi,
      functionName: 'getOwners',
      args: [[ADDR_A, ADDR_B]],
    });
    expect(writeText).toHaveBeenCalledWith(`cast call ${CONTRACT} ${expected} --rpc-url ${RPC_1}`);

    fireEvent.click(calldataButton());
    expect(writeText).toHaveBeenLastCalledWith(expected);
  });

  it('disables the copy actions with the offending field as tooltip while args are invalid', () => {
    const func = makeFunc(
      [
        { name: 'owner', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      'info',
    );
    renderForm(func, { contractAddress: CONTRACT });

    // Live (no submit needed): an invalid value kills the command with
    // the field-level reason.
    fireEvent.change(screen.getByLabelText('owner (address)'), { target: { value: 'nope' } });
    expect(castButton()).toBeDisabled();
    expect(calldataButton()).toBeDisabled();
    expect(castButton()).toHaveAttribute('title', 'owner: invalid address');

    // A non-trailing empty required arg does the same.
    fireEvent.change(screen.getByLabelText('owner (address)'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('amount (uint256)'), { target: { value: '5' } });
    expect(castButton()).toHaveAttribute('title', 'owner: required');

    // Filling it back re-enables both.
    fireEvent.change(screen.getByLabelText('owner (address)'), { target: { value: ADDR_A } });
    expect(castButton()).toBeEnabled();
    expect(calldataButton()).toBeEnabled();
  });

  it('is disabled when the contract address is not provided', () => {
    renderForm(makeFunc([{ name: 'who', type: 'address' }], 'balanceOf'));

    expect(castButton()).toBeDisabled();
    expect(castButton()).toHaveAttribute('title', 'contract address unavailable');
  });

  it('reports a failed clipboard honestly instead of claiming success', async () => {
    stubClipboard(undefined);
    renderForm(makeFunc([], 'decimals'), { contractAddress: CONTRACT });

    fireEvent.click(castButton());

    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copied ✓' })).not.toBeInTheDocument();
  });
});
