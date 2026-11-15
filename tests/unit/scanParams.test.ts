// utils/scanParams: the shared scan-route query readers — refreshSchema
// (exact-literal '1' cache-bypass; every other spelling degrades to a
// cache-serving read), readStrictInt (tri-kind absent/value/invalid
// strict decimal parse; valid-prefix junk like '0x10'/'1e2'/' 7 ' is
// invalid, never a silently reinterpreted page) and windowParam (strict
// 1..50_000_000 window; junk and out-of-range degrade to the tiered
// default, never a Number()-coerced sweep). The route suites
// (transfersRouteMode / approvalsRoute / tokenTransfersRefresh) pin the
// wiring; this pins the module's own contract.
import { describe, it, expect } from 'vitest';

import { readStrictInt, refreshSchema, windowParam } from '@/utils/scanParams';

describe('refreshSchema', () => {
  it('parses only the exact literal "1" as a re-scan', () => {
    expect(refreshSchema.parse('1')).toBe('1');
  });

  it.each([undefined, '', 'true', '0', 'abc', '01', '1 '])(
    'degrades %j to undefined (cache-serving read)',
    value => {
      expect(refreshSchema.parse(value)).toBeUndefined();
    },
  );
});

describe('readStrictInt', () => {
  it('reports absent for a missing or empty param', () => {
    expect(readStrictInt(undefined)).toEqual({ kind: 'absent' });
    expect(readStrictInt('')).toEqual({ kind: 'absent' });
  });

  it('reports the parsed value for a plain decimal integer', () => {
    expect(readStrictInt('0')).toEqual({ kind: 'value', value: 0 });
    expect(readStrictInt('250000')).toEqual({ kind: 'value', value: 250000 });
  });

  it.each(['0x10', '1e2', ' 7 ', '5abc', '-3', '2.5', '99999999999999999999'])(
    'reports invalid for valid-prefix or non-decimal junk (%s)',
    value => {
      expect(readStrictInt(value)).toEqual({ kind: 'invalid' });
    },
  );
});

describe('windowParam', () => {
  it('degrades a missing or empty param to undefined (tiered default)', () => {
    expect(windowParam(undefined)).toBeUndefined();
    expect(windowParam('')).toBeUndefined();
  });

  it('returns the block count for an in-range plain decimal window', () => {
    expect(windowParam('1')).toBe(1);
    expect(windowParam('250000')).toBe(250_000);
    expect(windowParam('50000000')).toBe(50_000_000);
  });

  it('degrades out-of-range windows to undefined instead of clamping', () => {
    expect(windowParam('0')).toBeUndefined();
    expect(windowParam('50000001')).toBeUndefined();
    expect(windowParam('999999999')).toBeUndefined();
  });

  it.each(['0x10', '1e2', ' 7 ', '+7', '5abc', '-3', '2.5'])(
    'degrades the Number()-coercible junk %j to undefined, never the coerced number',
    value => {
      expect(windowParam(value)).toBeUndefined();
    },
  );
});
