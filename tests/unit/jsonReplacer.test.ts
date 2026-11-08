// The BigInt-safe JSON replacer leaf: import-free so any graph (browser,
// server, mcp) can adopt it; bigint → decimal string, everything else
// passes through untouched (key excluded).
import { describe, it, expect } from 'vitest';
import { bigintJsonReplacer } from '@/utils/jsonReplacer';

describe('bigintJsonReplacer', () => {
  it('stringifies bigint values as decimal strings', () => {
    expect(bigintJsonReplacer('wei', 1234500000000000000n)).toBe('1234500000000000000');
    expect(bigintJsonReplacer('negative', -42n)).toBe('-42');
    expect(bigintJsonReplacer('zero', 0n)).toBe('0');
  });

  it('passes every non-bigint value through unchanged', () => {
    expect(bigintJsonReplacer('n', 1)).toBe(1);
    expect(bigintJsonReplacer('s', 'x')).toBe('x');
    expect(bigintJsonReplacer('b', true)).toBe(true);
    expect(bigintJsonReplacer('nil', null)).toBe(null);
    const obj = { a: 1 };
    expect(bigintJsonReplacer('o', obj)).toBe(obj);
  });

  it('makes JSON.stringify bigint payloads work end to end', () => {
    const payload = { blockNumber: 19000000n, hash: '0xabc', nested: { gas: 21000n } };
    expect(JSON.parse(JSON.stringify(payload, bigintJsonReplacer))).toEqual({
      blockNumber: '19000000',
      hash: '0xabc',
      nested: { gas: '21000' },
    });
  });
});
