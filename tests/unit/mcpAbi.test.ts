// Unit tests for the MCP read_contract argument coercion: JSON values →
// viem values keyed on the parsed ABI fragment's input types.

import { describe, expect, it } from 'vitest';
import { McpArgError, coerceArgs, parseFunctionFragment } from '@/mcp/abi';

describe('parseFunctionFragment', () => {
  it('parses a human-readable signature', () => {
    const fragment = parseFunctionFragment('function balanceOf(address account) view returns (uint256)');
    expect(fragment.name).toBe('balanceOf');
    expect(fragment.inputs).toHaveLength(1);
    expect(fragment.stateMutability).toBe('view');
  });

  it('teaches the expected syntax on junk', () => {
    expect(() => parseFunctionFragment('balanceOf(address)')).toThrow(McpArgError);
    expect(() => parseFunctionFragment('event Transfer(address,address,uint256)')).toThrow(/function/);
    expect(() => parseFunctionFragment('nonsense')).toThrow(/human-readable Solidity syntax/);
  });
});

describe('coerceArgs', () => {
  it('converts numbers and decimal strings to bigint for int/uint', () => {
    const fragment = parseFunctionFragment('function f(uint256 a, int8 b) view returns (uint256)');
    const coerced = coerceArgs([1500000, '-3'], fragment);
    expect(coerced[0]).toBe(1500000n);
    expect(coerced[1]).toBe(-3n);
  });

  it('accepts 0x-hex integer strings', () => {
    const fragment = parseFunctionFragment('function f(uint256 a) view returns (uint256)');
    expect((coerceArgs(['0x10'], fragment))[0]).toBe(16n);
  });

  it('keeps full precision for values beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = '123456789012345678901234567890';
    const fragment = parseFunctionFragment('function f(uint256 a) view returns (uint256)');
    expect((coerceArgs([huge], fragment))[0]).toBe(BigInt(huge));
  });

  it('rejects fractional numbers with a precision hint', () => {
    const fragment = parseFunctionFragment('function f(uint256 a) view returns (uint256)');
    expect(() => coerceArgs([1.5], fragment)).toThrow(/decimal strings/);
  });

  it('rejects a JSON number that already lost precision past 2^53', () => {
    // The args literal 10000000000000001 was already rounded by JSON.parse
    // to the double 10000000000000000 (spelled out here so the test states
    // the delivered value); it IS an integer, so an isInteger check waves it
    // through and the contract call would silently read the wrong value.
    const fragment = parseFunctionFragment('function f(uint256 a) view returns (uint256)');
    expect(() => coerceArgs([10000000000000000], fragment)).toThrow(
      'args[0]: 10000000000000000 exceeds the exact integer range — pass it as a decimal string to keep precision',
    );
    // Below the safe range the number shape is still fine.
    expect((coerceArgs([1000000000000000], fragment))[0]).toBe(1000000000000000n);
  });

  it('validates addresses and booleans with field paths', () => {
    const fragment = parseFunctionFragment('function f(address a, bool b) view returns (bool)');
    expect(() => coerceArgs(['0x123', true], fragment)).toThrow('args[0]');
    expect(() => coerceArgs([`0x${'ab'.repeat(20)}`, 'yes'], fragment)).toThrow('args[1]');
    const good = coerceArgs([`0x${'ab'.repeat(20)}`, 'false'], fragment);
    expect(good[1]).toBe(false);
  });

  it('coerces nested arrays with fixed-length checks', () => {
    const fragment = parseFunctionFragment('function f(uint256[2][] rows) view returns (uint256)');
    const good = coerceArgs([['1,2'.split(',').map(Number), [3n, '4']]], fragment);
    expect(good[0]).toEqual([
      [1n, 2n],
      [3n, 4n],
    ]);
    expect(() => coerceArgs([[[1, 2, 3]]], fragment)).toThrow(/exactly 2 elements/);
    expect(() => coerceArgs([42], fragment)).toThrow('args[0]');
  });

  it('coerces tuples component-wise', () => {
    const fragment = parseFunctionFragment(
      'function f((address owner, uint256 amount) pledge) view returns (uint256)',
    );
    const coerced = coerceArgs([[`0x${'ab'.repeat(20)}`, '7']], fragment);
    expect(coerced[0]).toEqual([`0x${'ab'.repeat(20)}`, 7n]);
  });

  it('passes bytes and strings through with basic shape checks', () => {
    const fragment = parseFunctionFragment(
      'function f(bytes data, string label) view returns (uint256)',
    );
    const good = coerceArgs(['0xdeadbeef', 'hello'], fragment);
    expect(good).toEqual(['0xdeadbeef', 'hello']);
    expect(() => coerceArgs(['deadbeef', 'hello'], fragment)).toThrow('args[0]');
  });

  it('enforces the declared argument count', () => {
    const fragment = parseFunctionFragment('function f(address a) view returns (uint256)');
    expect(() => coerceArgs([], fragment)).toThrow(/takes 1 argument/);
    expect(() => coerceArgs([`0x${'ab'.repeat(20)}`, `0x${'ab'.repeat(20)}`], fragment)).toThrow(/got 2/);
  });
});
