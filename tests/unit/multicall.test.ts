// The canonical Multicall3 constant and the outcome-narrowing helpers it
// ships with (utils/multicall): one home for what four services
// (tokenMetadata, tokenDirectory, knownTokenBalances, ApprovalScanService)
// each re-declared. The narrowing contract: with allowFailure viem wraps
// each result as { status: 'success', result } or
// { status: 'failure', error }, test doubles may hand back a bare null
// for a reverted call, and anything unrecognized decodes to null — a
// failed or stubbed read is an honest absence, never a guessed value.
import { describe, it, expect } from 'vitest';

import {
  MULTICALL3_ADDRESS,
  readMulticallBigint,
  readMulticallResult,
  readMulticallValue,
} from '@/utils/multicall';

describe('MULTICALL3_ADDRESS', () => {
  it('is the canonical checksummed deployment', () => {
    expect(MULTICALL3_ADDRESS).toBe('0xcA11bde05977b3631167028862bE2a173976CA11');
  });
});

describe('readMulticallValue', () => {
  it('unwraps a successful string result', () => {
    expect(readMulticallValue({ status: 'success', result: 'WETH' })).toBe('WETH');
  });

  it('unwraps a successful number result (decimals)', () => {
    expect(readMulticallValue({ status: 'success', result: 18 })).toBe(18);
  });

  it('decodes a failure outcome to null', () => {
    expect(readMulticallValue({ status: 'failure', error: new Error('revert') })).toBeNull();
  });

  it('decodes a bare null test double to null', () => {
    expect(readMulticallValue(null)).toBeNull();
  });

  it('decodes non-object shapes to null', () => {
    expect(readMulticallValue(undefined)).toBeNull();
    expect(readMulticallValue('success')).toBeNull();
    expect(readMulticallValue(42)).toBeNull();
  });

  it('decodes a success whose result is not a string/number to null', () => {
    // totalSupply-shaped reads belong to readMulticallBigint; the value
    // helper must not leak them through as-is.
    expect(readMulticallValue({ status: 'success', result: 123n })).toBeNull();
    expect(readMulticallValue({ status: 'success', result: true })).toBeNull();
    expect(readMulticallValue({ status: 'success' })).toBeNull();
  });
});

describe('readMulticallBigint', () => {
  it('unwraps a successful bigint result (uint256 reads)', () => {
    expect(readMulticallBigint({ status: 'success', result: 1_000_000n })).toBe(1_000_000n);
  });

  it('decodes a failure outcome to null', () => {
    expect(readMulticallBigint({ status: 'failure', error: new Error('revert') })).toBeNull();
  });

  it('decodes a bare null test double to null', () => {
    expect(readMulticallBigint(null)).toBeNull();
  });

  it('decodes non-object shapes to null', () => {
    expect(readMulticallBigint(undefined)).toBeNull();
    expect(readMulticallBigint('1000000')).toBeNull();
  });

  it('decodes a success whose result is not a bigint to null (the row is skipped, never invented)', () => {
    expect(readMulticallBigint({ status: 'success', result: '1000000' })).toBeNull();
    expect(readMulticallBigint({ status: 'success', result: 0 })).toBeNull();
  });

  it('still unwraps a zero bigint (a genuine on-chain zero, distinct from a revert)', () => {
    expect(readMulticallBigint({ status: 'success', result: 0n })).toBe(0n);
  });
});

describe('readMulticallResult', () => {
  it('unwraps the RAW result without narrowing its type (mixed-kind batches)', () => {
    expect(readMulticallResult({ status: 'success', result: 5_000n })).toBe(5_000n);
    expect(readMulticallResult({ status: 'success', result: true })).toBe(true);
    expect(readMulticallResult({ status: 'success', result: '0xabc0000000000000000000000000000000000000' })).toBe(
      '0xabc0000000000000000000000000000000000000',
    );
  });

  it('decodes a failure outcome to null', () => {
    expect(readMulticallResult({ status: 'failure', error: new Error('revert') })).toBeNull();
  });

  it('decodes a bare null test double and non-object shapes to null', () => {
    expect(readMulticallResult(null)).toBeNull();
    expect(readMulticallResult(undefined)).toBeNull();
    expect(readMulticallResult('0x1234')).toBeNull();
  });
});
