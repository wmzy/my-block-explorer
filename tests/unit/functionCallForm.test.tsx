// FunctionCallForm wiring tests: the pure parser's output actually drives
// the form — composite inputs submit as real JS arrays/tuples, invalid
// values render field-level inline errors (no submit), trailing inputs may
// be left empty (omitted from the call, hinted via placeholder), and a
// non-trailing empty input blocks the submit with a 'required' error.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { FunctionCallForm } from '@/views/Contract/FunctionCallForm';
import type {
  ContractFunctionInput,
  EnhancedContractFunction,
} from '@/utils/contractInteraction';

const ADDR_A = '0x1111111111111111111111111111111111111111';
const ADDR_B = '0x2222222222222222222222222222222222222222';

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

function renderForm(func: TestFunction) {
  const onCall = vi.fn();
  render(
    <FunctionCallForm
      func={func}
      onCall={onCall}
      results={{}}
      errors={{}}
      loadingStates={{}}
      chainId={1}
      blockNumber=""
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
    );

    fireEvent.change(field, { target: { value: `${ADDR_A},${ADDR_B}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    expect(onCall).toHaveBeenLastCalledWith(
      func,
      [[ADDR_A, ADDR_B]],
      [`${ADDR_A},${ADDR_B}`],
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
  const func = makeFunc(
    [
      { name: 'owner', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    'setOwner',
  );

  it('omits an empty trailing input from the submitted values', () => {
    const onCall = renderForm(func);

    fireEvent.change(screen.getByLabelText('owner (address)'), {
      target: { value: ADDR_A },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    expect(onCall).toHaveBeenCalledWith(func, [ADDR_A], [ADDR_A, ''], undefined, undefined);
  });

  it('hints the omission on inputs that may be left empty', () => {
    renderForm(func);

    expect(screen.getByLabelText('amount (uint256)')).toHaveAttribute(
      'placeholder',
      'optional — leave empty to omit',
    );
    // With the amount still empty, the owner input is also part of the
    // omittable trailing run; filling the amount makes it required again.
    expect(screen.getByLabelText('owner (address)')).toHaveAttribute(
      'placeholder',
      'optional — leave empty to omit',
    );

    fireEvent.change(screen.getByLabelText('amount (uint256)'), {
      target: { value: '5' },
    });
    expect(screen.getByLabelText('owner (address)')).toHaveAttribute(
      'placeholder',
      'Enter address',
    );
    // The last input stays omittable no matter what follows (nothing
    // does); with a value entered its placeholder is simply not shown.
    expect(screen.getByLabelText('amount (uint256)')).toHaveAttribute(
      'placeholder',
      'optional — leave empty to omit',
    );
  });

  it('blocks a non-trailing empty input with a required error', async () => {
    const onCall = renderForm(func);

    fireEvent.change(screen.getByLabelText('amount (uint256)'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    expect(await screen.findByText('owner: required')).toBeInTheDocument();
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

    expect(onCall).toHaveBeenCalledWith(func, [], [], undefined, ADDR_A);
  });

  it('keeps From optional — empty submits as undefined', () => {
    const onCall = renderForm(func);

    fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));

    expect(onCall).toHaveBeenCalledWith(func, [], [], undefined, undefined);
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
