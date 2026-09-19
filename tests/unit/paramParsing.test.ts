// Unit tests for the Interact form's pure argument parser: composite
// inputs (arrays, tuples) parsed from JSON-style or bare comma lists with
// field-level errors naming the parameter and index, the trailing-optional
// omission rule, and faithful call-error classification.
import { describe, it, expect } from 'vitest';

import { parseFunctionArgs, describeCallError, paramLabel } from '@/views/Contract/paramParsing';
import type { ParamDescriptor } from '@/views/Contract/paramParsing';
import { ApiError } from '@/util/apiError';
import { encodeFunctionData } from 'viem';

const ADDR_A = '0x1111111111111111111111111111111111111111';
const ADDR_B = '0x2222222222222222222222222222222222222222';
const UINT256_MAX =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

const param = (name: string, type: string, components?: ParamDescriptor[]): ParamDescriptor => ({
  name,
  type,
  components,
});

const parse = (inputs: ParamDescriptor[], rawArgs: string[]) => parseFunctionArgs(inputs, rawArgs);

describe('parseFunctionArgs composite arrays', () => {
  const addrs = [param('addrs', 'address[]')];

  it('parses a JSON-style array into a real JS array', () => {
    const result = parse(addrs, [`["${ADDR_A}","${ADDR_B}"]`]);
    expect(result.isValid).toBe(true);
    expect(result.fieldErrors).toEqual(['']);
    expect(result.values).toEqual([[ADDR_A, ADDR_B]]);
  });

  it('accepts single-quoted and unquoted bracketed lists', () => {
    expect(parse(addrs, [`['${ADDR_A}','${ADDR_B}']`]).values).toEqual([[ADDR_A, ADDR_B]]);
    expect(parse(addrs, [`[${ADDR_A},${ADDR_B}]`]).values).toEqual([[ADDR_A, ADDR_B]]);
  });

  it('accepts a bare comma-separated list with surrounding whitespace', () => {
    expect(parse(addrs, [`  ${ADDR_A} , ${ADDR_B}  `]).values).toEqual([[ADDR_A, ADDR_B]]);
  });

  it('parses an empty list literal as a zero-length array', () => {
    expect(parse(addrs, ['[]']).values).toEqual([[]]);
  });

  it('flags the offending element with parameter name and index', () => {
    const result = parse(addrs, [`${ADDR_A},0xnope`]);
    expect(result.isValid).toBe(false);
    expect(result.fieldErrors).toEqual(['addrs[1]: invalid address']);
  });

  it('reports malformed bracket input instead of throwing', () => {
    const result = parse(addrs, [`["${ADDR_A}"`]);
    expect(result.isValid).toBe(false);
    expect(result.fieldErrors[0]).toMatch(/^addrs: malformed list/);
  });

  it('enforces fixed-size array lengths', () => {
    const fixed = [param('pair', 'address[2]')];
    expect(parse(fixed, [`${ADDR_A}`]).fieldErrors).toEqual(['pair: expected 2 items, got 1']);
    expect(parse(fixed, [`${ADDR_A},${ADDR_B}`]).values).toEqual([[ADDR_A, ADDR_B]]);
  });

  it('parses nested arrays element-wise', () => {
    const nested = [param('matrix', 'address[2][]')];
    const raw = `[[${ADDR_A},${ADDR_B}],[${ADDR_B},${ADDR_A}]]`;
    expect(parse(nested, [raw]).values).toEqual([
      [
        [ADDR_A, ADDR_B],
        [ADDR_B, ADDR_A],
      ],
    ]);

    const bad = `[[${ADDR_A},${ADDR_B}],[${ADDR_B},nope]]`;
    expect(parse(nested, [bad]).fieldErrors).toEqual(['matrix[1][1]: invalid address']);
  });

  it('keeps full precision for huge integers split from raw text', () => {
    const amounts = [param('amounts', 'uint256[]')];
    const result = parse(amounts, [`${UINT256_MAX},0x1a`]);
    expect(result.values).toEqual([[UINT256_MAX, '0x1a']]);
  });
});

describe('parseFunctionArgs tuples', () => {
  const point = [param('p', 'tuple', [param('x', 'uint256'), param('y', 'address')])];

  it('parses a flat comma list into a positional tuple array', () => {
    const result = parse(point, [`5,${ADDR_A}`]);
    expect(result.isValid).toBe(true);
    expect(result.values).toEqual([['5', ADDR_A]]);
  });

  it('accepts parenthesized and JSON-style tuple literals', () => {
    expect(parse(point, [`(5, ${ADDR_A})`]).values).toEqual([['5', ADDR_A]]);
    expect(parse(point, [`["5","${ADDR_A}"]`]).values).toEqual([['5', ADDR_A]]);
  });

  it('validates components recursively and names the component', () => {
    const result = parse(point, ['5,notanaddress']);
    expect(result.isValid).toBe(false);
    expect(result.fieldErrors).toEqual(['p.y: invalid address']);
  });

  it('flags a wrong tuple arity', () => {
    const result = parse(point, ['5']);
    expect(result.fieldErrors).toEqual(['p: expected 2 tuple values, got 1']);
  });

  it('recurses through arrays of tuples', () => {
    const points = [param('points', 'tuple[]', [param('x', 'uint256'), param('y', 'address')])];
    const raw = `[[1,${ADDR_A}],[2,nope]]`;
    const result = parse(points, [raw]);
    expect(result.fieldErrors).toEqual(['points[1].y: invalid address']);

    expect(parse(points, [`[[1,${ADDR_A}],[2,${ADDR_B}]]`]).values).toEqual([
      [
        ['1', ADDR_A],
        ['2', ADDR_B],
      ],
    ]);
  });

  it('indexes unnamed tuple components positionally in errors', () => {
    const anon = [param('t', 'tuple', [param('', 'uint256'), param('', 'address')])];
    expect(parse(anon, ['1,nope']).fieldErrors).toEqual(['t[1]: invalid address']);
  });
});

describe('parseFunctionArgs scalars', () => {
  it('accepts decimal and hex integer strings within range', () => {
    const inputs = [param('n', 'uint256'), param('i', 'int8'), param('h', 'uint128')];
    const result = parse(inputs, [UINT256_MAX, '-128', '0x1a']);
    expect(result.isValid).toBe(true);
    expect(result.values).toEqual([UINT256_MAX, '-128', '0x1a']);
  });

  it('rejects non-integer and out-of-range values per field', () => {
    const inputs = [param('n', 'uint256'), param('small', 'uint8'), param('s', 'int8')];
    const result = parse(inputs, ['1.5', '300', '-300']);
    expect(result.fieldErrors).toEqual([
      'n: invalid uint256 — expected an integer',
      'small: value out of range for uint8',
      's: value out of range for int8',
    ]);
  });

  it('converts bools explicitly and rejects anything else', () => {
    expect(parse([param('flag', 'bool')], ['True']).values).toEqual([true]);
    expect(parse([param('flag', 'bool')], ['FALSE']).values).toEqual([false]);
    expect(parse([param('flag', 'bool')], ['yes']).fieldErrors).toEqual([
      'flag: invalid bool — use true or false',
    ]);
  });

  it('validates bytes hex format and exact fixed lengths', () => {
    expect(parse([param('data', 'bytes')], ['0xdeadbeef']).values).toEqual(['0xdeadbeef']);
    expect(parse([param('data', 'bytes')], ['0xabc']).fieldErrors).toEqual([
      'data: invalid bytes — odd hex length',
    ]);
    expect(parse([param('h', 'bytes32')], [`0x${'ab'.repeat(32)}`]).values).toEqual([
      `0x${'ab'.repeat(32)}`,
    ]);
    expect(parse([param('h', 'bytes32')], ['0x1234']).fieldErrors).toEqual([
      'h: invalid bytes32 — expected 64 hex digits',
    ]);
    expect(parse([param('h', 'bytes4')], ['zzzz']).fieldErrors).toEqual([
      'h: invalid bytes4 — expected 0x-prefixed hex',
    ]);
  });

  it('passes strings through untouched, commas included', () => {
    expect(parse([param('note', 'string')], ['hello, world']).values).toEqual(['hello, world']);
  });
});

describe('parseFunctionArgs empty-input rule', () => {
  const inputs = [param('owner', 'address'), param('amount', 'uint256')];

  it('omits the trailing run of empty inputs from the encoded call', () => {
    const result = parse(inputs, [ADDR_A, '']);
    expect(result.isValid).toBe(true);
    expect(result.values).toEqual([ADDR_A]);
  });

  it('omits everything when all inputs are empty', () => {
    const result = parse(inputs, ['', '']);
    expect(result.isValid).toBe(true);
    expect(result.values).toEqual([]);
  });

  it('flags a non-trailing empty input as required', () => {
    const result = parse(inputs, ['', '5']);
    expect(result.isValid).toBe(false);
    expect(result.fieldErrors).toEqual(['owner: required', '']);
  });

  it('labels unnamed inputs by position', () => {
    const result = parse([param('', 'address'), param('n', 'uint256')], ['', '5']);
    expect(result.fieldErrors[0]).toBe('arg 0: required');
    expect(paramLabel(param('', 'uint256'), 1)).toBe('arg 1');
  });
});

describe('parser output is encoder-ready', () => {
  it('feeds parsed composite and scalar values straight into viem', () => {
    const inputs = [
      param('addrs', 'address[]'),
      param('p', 'tuple', [param('x', 'uint256'), param('y', 'address')]),
      param('flag', 'bool'),
      param('data', 'bytes32'),
      param('n', 'uint256'),
    ];
    const { values, isValid } = parseFunctionArgs(inputs, [
      `${ADDR_A},${ADDR_B}`,
      `5,${ADDR_A}`,
      'true',
      `0x${'ab'.repeat(32)}`,
      UINT256_MAX,
    ]);
    expect(isValid).toBe(true);

    const abi = [
      {
        type: 'function',
        name: 'f',
        inputs: [
          { name: 'addrs', type: 'address[]' },
          {
            name: 'p',
            type: 'tuple',
            components: [
              { name: 'x', type: 'uint256' },
              { name: 'y', type: 'address' },
            ],
          },
          { name: 'flag', type: 'bool' },
          { name: 'data', type: 'bytes32' },
          { name: 'n', type: 'uint256' },
        ],
        outputs: [],
        stateMutability: 'view',
      },
    ];
    const data = encodeFunctionData({ abi, functionName: 'f', args: values });
    expect(data).toMatch(/^0x[0-9a-f]+$/);
    expect(data.toLowerCase()).toContain(ADDR_A.slice(2).toLowerCase());
    expect(data.toLowerCase()).toContain(BigInt(UINT256_MAX).toString(16).padStart(64, '0'));
  });
});

describe('describeCallError', () => {
  it('keeps the status for ApiError failures', () => {
    expect(describeCallError(new ApiError('contract source unavailable', 502))).toBe(
      'API error (502): contract source unavailable',
    );
  });

  it('labels transport failures as network errors with their message', () => {
    expect(describeCallError(new TypeError('fetch failed'))).toBe('Network error: fetch failed');
    const http = new Error('HTTP request failed (POST http://127.0.0.1:8545): 500');
    expect(describeCallError(http)).toBe(`Network error: ${http.message}`);
  });

  it('preserves encoder error messages verbatim', () => {
    const encode = new Error('ABI encoding params/values length mismatch.');
    expect(describeCallError(encode)).toBe('ABI encoding params/values length mismatch.');
  });

  it('handles strings and unknown shapes', () => {
    expect(describeCallError('node rejected the call')).toBe('node rejected the call');
    expect(describeCallError(null)).toBe('Unknown error');
    expect(describeCallError({ weird: true })).toBe('Unknown error');
  });
});
