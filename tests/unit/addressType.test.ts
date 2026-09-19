// Pure-classification tests for the address page's type verdict: the
// EIP-7702 designator check (which outranks the persistent record's
// "has code → contract" rule), persistent-over-RPC precedence for plain
// code, and the delegate-address extraction behind the tooltip.
import { describe, it, expect } from 'vitest';
import { getAddress } from 'viem';
import {
  classifyAddressType,
  delegationTarget,
  isEip7702Designator,
} from '@/views/Address/addressType';

const delegate = `0x${'ab'.repeat(20)}`;
const designator = `0xef0100${delegate.slice(2)}`;
const otherDesignator = `0xef0100${'cd'.repeat(20)}`;
const contractCode = '0x608060405234801561000f57600080fd5b50';

describe('classifyAddressType', () => {
  it('classifies an EIP-7702 designator as a delegated EOA', () => {
    expect(classifyAddressType({ rpcCode: designator })).toBe('delegated-eoa');
  });

  it('accepts an uppercase designator read as a designator too', () => {
    expect(
      classifyAddressType({ rpcCode: designator.toUpperCase() }),
    ).toBe('delegated-eoa');
  });

  it('outranks a persistent contract record: a delegated EOA is not a contract', () => {
    // The persistent channel files "has code" under isContract=true, but a
    // 7702 designator is the authoritative signal that this is an account.
    expect(
      classifyAddressType({ persistentType: true, rpcCode: designator }),
    ).toBe('delegated-eoa');
  });

  it('outranks a persistent EOA record: the delegation happened after sync', () => {
    expect(
      classifyAddressType({ persistentType: false, rpcCode: designator }),
    ).toBe('delegated-eoa');
  });

  it('keeps the persistent verdict when the code is not a designator', () => {
    expect(classifyAddressType({ persistentType: true })).toBe('contract');
    expect(classifyAddressType({ persistentType: false })).toBe('eoa');
    // Persistent wins over plain bytecode in both directions.
    expect(
      classifyAddressType({ persistentType: false, rpcCode: contractCode }),
    ).toBe('eoa');
    expect(classifyAddressType({ persistentType: true, rpcCode: '0x' })).toBe(
      'contract',
    );
  });

  it('classifies from the RPC code alone when no persistent record exists', () => {
    expect(classifyAddressType({ rpcCode: contractCode })).toBe('contract');
    expect(classifyAddressType({ rpcCode: '0x' })).toBe('eoa');
  });

  it('returns unknown while both channels are unsettled', () => {
    expect(classifyAddressType({})).toBe('unknown');
  });

  it('does not treat a truncated 0xef-prefixed read as a designator', () => {
    // Wrong length (not exactly 0xef0100 + 20 bytes) falls through to the
    // plain-code classification instead of a delegated verdict.
    expect(classifyAddressType({ rpcCode: '0xef0100deadbeef' })).toBe('contract');
    expect(classifyAddressType({ rpcCode: `${designator}00` })).toBe('contract');
  });
});

describe('delegationTarget', () => {
  it('extracts and checksums the 20-byte delegate address', () => {
    expect(delegationTarget(designator)).toBe(getAddress(delegate));
    expect(delegationTarget(otherDesignator)).toBe(
      getAddress(`0x${'cd'.repeat(20)}`),
    );
  });

  it('returns undefined for non-designators', () => {
    expect(delegationTarget(contractCode)).toBeUndefined();
    expect(delegationTarget('0x')).toBeUndefined();
    expect(delegationTarget(undefined)).toBeUndefined();
    expect(delegationTarget(`${designator}00`)).toBeUndefined();
  });
});

describe('isEip7702Designator', () => {
  it('recognizes exactly the 0xef0100 + 20-byte form', () => {
    expect(isEip7702Designator(designator)).toBe(true);
    expect(isEip7702Designator(undefined)).toBe(false);
    expect(isEip7702Designator('0xef0100')).toBe(false);
    expect(isEip7702Designator(contractCode)).toBe(false);
  });
});
