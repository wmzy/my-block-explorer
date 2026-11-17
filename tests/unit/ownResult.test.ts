// Contract for util/useQuery's ownResult settle guard: the query store
// keeps the last settle across an args switch, so only a payload whose own
// echo matches EVERY passed key serves — anything else is absent.
import { describe, expect, it } from 'vitest';

import { ownResult } from '@/util/useQuery';

type Payload = { chainId: number; address?: string; value: number };

describe('ownResult', () => {
  const payload: Payload = { chainId: 1, address: '0xabc', value: 5 };

  it('serves a payload whose keys all match', () => {
    expect(ownResult(payload, { chainId: 1 })).toBe(payload);
    expect(ownResult(payload, { chainId: 1, address: '0xabc' })).toBe(payload);
  });

  it('treats a foreign-chain payload as absent', () => {
    expect(ownResult(payload, { chainId: 2 })).toBeUndefined();
  });

  it('treats a foreign-key payload as absent (not just chainId)', () => {
    expect(ownResult(payload, { chainId: 1, address: '0xdef' })).toBeUndefined();
  });

  it('treats undefined data as absent', () => {
    expect(ownResult(undefined, { chainId: 1 })).toBeUndefined();
  });

  it('requires exact === semantics: 0 is a value, not an absence', () => {
    const zero: Payload = { chainId: 0, value: 0 };
    expect(ownResult(zero, { chainId: 0 })).toBe(zero);
    expect(ownResult(payload, { chainId: 0 })).toBeUndefined();
  });

  it('does not require keys the caller did not pass', () => {
    // value is never compared here — partial args stay partial.
    expect(ownResult(payload, { chainId: 1 })).toBe(payload);
  });
});
