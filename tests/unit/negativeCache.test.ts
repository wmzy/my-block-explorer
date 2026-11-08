// Negative-cache freshness pins: a NULL timestamp is EXPIRED, never
// fresh — stated as a contract, not left to the arithmetic of the old
// hand-rolled shape. (The legacy
// `(Date.now() - (row?.fetchedAt?.getTime() ?? 0)) / MS_PER_HOUR < TTL`
// bound null to the epoch, so null WAS already expired — but only as an
// accident of parenthesization; `(Date.now() - row?.ts?.getTime()) ?? 0`
// variants evaluate to NaN, which also compares false. The helper makes
// the intended semantics explicit and shared.) Service-level pins live
// in signatureService and storageLayoutService tests.
import { describe, it, expect } from 'vitest';
import { ageHours, negativeEntryFresh } from '@/utils/negativeCache';

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

describe('negativeEntryFresh', () => {
  it('a NOT_FOUND row with null/undefined fetchedAt is NOT fresh (explicit contract)', () => {
    expect(negativeEntryFresh(null, 24)).toBe(false);
    expect(negativeEntryFresh(undefined, 24)).toBe(false);
  });

  it('treats a row inside the TTL window as fresh', () => {
    expect(negativeEntryFresh(hoursAgo(1), 24)).toBe(true);
    expect(negativeEntryFresh(new Date(), 1)).toBe(true);
  });

  it('treats a row past the TTL window as expired', () => {
    expect(negativeEntryFresh(hoursAgo(25), 24)).toBe(false);
    expect(negativeEntryFresh(hoursAgo(24.001), 24)).toBe(false);
  });

  it('keeps each caller TTL tier at the call site (no tier lives here)', () => {
    expect(negativeEntryFresh(hoursAgo(2), 1)).toBe(false);
    expect(negativeEntryFresh(hoursAgo(2), 24)).toBe(true);
  });
});

describe('ageHours', () => {
  it('reads a missing timestamp as infinitely old', () => {
    expect(ageHours(null)).toBe(Number.POSITIVE_INFINITY);
    expect(ageHours(undefined)).toBe(Number.POSITIVE_INFINITY);
  });

  it('computes elapsed hours', () => {
    expect(ageHours(hoursAgo(3))).toBeGreaterThan(2.99);
    expect(ageHours(hoursAgo(3))).toBeLessThan(3.01);
    expect(ageHours(new Date())).toBeLessThan(0.01);
  });
});
