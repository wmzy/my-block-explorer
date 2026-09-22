// Watchlist storage contract: validation tiers (shape then checksum),
// checksum-preserved storage, case-insensitive dedupe, the 25-entry cap
// as an explicit rejection, removal, and best-effort storage degradation
// (mirrors searchHistory.test.ts).
import { describe, it, expect, beforeEach } from 'vitest';
import { getAddress } from 'viem';
import {
  addWatchlistEntry,
  readWatchlist,
  removeWatchlistEntry,
  WATCHLIST_MAX_ENTRIES,
  WATCHLIST_STORAGE_KEY,
} from '@/util/watchlist';

const CHECKSUMMED = getAddress('0x1234567890abcdef1234567890abcdef12345678');
const OTHER = getAddress('0xabcdef0000000000000000000000000000000001');

beforeEach(() => {
  localStorage.clear();
});

describe('readWatchlist', () => {
  it('reads back what was written, checksum-preserved', () => {
    const { entries } = addWatchlistEntry(CHECKSUMMED);
    expect(entries).toEqual([CHECKSUMMED]);
    expect(readWatchlist()).toEqual([CHECKSUMMED]);
    expect(localStorage.getItem(WATCHLIST_STORAGE_KEY)).toBe(JSON.stringify([CHECKSUMMED]));
  });

  it('returns [] for a missing key, corrupt JSON, or a non-array payload', () => {
    expect(readWatchlist()).toEqual([]);
    localStorage.setItem(WATCHLIST_STORAGE_KEY, '{not json');
    expect(readWatchlist()).toEqual([]);
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify({ not: 'an array' }));
    expect(readWatchlist()).toEqual([]);
  });

  it('drops hand-edited non-address entries and re-caps an oversized list', () => {
    localStorage.setItem(
      WATCHLIST_STORAGE_KEY,
      JSON.stringify(['nope', CHECKSUMMED, '0x123']),
    );
    expect(readWatchlist()).toEqual([CHECKSUMMED]);

    const oversized = Array.from(
      { length: WATCHLIST_MAX_ENTRIES + 10 },
      (_, i) => getAddress(`0x${(i + 1).toString(16).padStart(40, '0')}`),
    );
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(oversized));
    expect(readWatchlist()).toHaveLength(WATCHLIST_MAX_ENTRIES);
  });
});

describe('addWatchlistEntry - validation', () => {
  it('rejects a malformed shape with the format tier', () => {
    for (const bad of ['hello', '0x123', `0x${'g'.repeat(40)}`, '']) {
      expect(addWatchlistEntry(bad)).toMatchObject({ ok: false, reason: 'format' });
    }
  });

  it('rejects a wrong EIP-55 checksum with the checksum tier', () => {
    // Mixed-case body that is NOT the checksummed form of the address.
    const body = '1234567890AbCdEf1234567890abCdEf12345678';
    const forged = `0x${body}`;
    expect(forged).not.toBe(getAddress(forged));
    expect(addWatchlistEntry(forged)).toMatchObject({ ok: false, reason: 'checksum' });
    // And nothing was stored by a rejected add.
    expect(readWatchlist()).toEqual([]);
  });

  it('accepts the checksum-less conventions (all-lower/all-upper), stored checksummed', () => {
    const lower = CHECKSUMMED.toLowerCase();
    expect(addWatchlistEntry(lower)).toMatchObject({ ok: true });
    expect(readWatchlist()).toEqual([CHECKSUMMED]);
  });
});

describe('addWatchlistEntry - dedupe and cap', () => {
  it('dedupes case-insensitively against the stored (checksummed) form', () => {
    addWatchlistEntry(CHECKSUMMED);
    const result = addWatchlistEntry(CHECKSUMMED.toLowerCase());
    expect(result).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(readWatchlist()).toEqual([CHECKSUMMED]);
  });

  it('rejects the 26th address instead of silently dropping an older one', () => {
    for (let i = 0; i < WATCHLIST_MAX_ENTRIES; i++) {
      const address = getAddress(`0x${(i + 1).toString(16).padStart(40, '0')}`);
      expect(addWatchlistEntry(address).ok).toBe(true);
    }
    expect(readWatchlist()).toHaveLength(WATCHLIST_MAX_ENTRIES);

    const overflow = getAddress(`0x${'ff'.repeat(19)}01`);
    const result = addWatchlistEntry(overflow);
    expect(result).toMatchObject({ ok: false, reason: 'full' });
    expect(readWatchlist()).not.toContain(overflow);
  });

  it('trims whitespace before validating', () => {
    expect(addWatchlistEntry(`  ${CHECKSUMMED}  `)).toMatchObject({ ok: true });
  });
});

describe('removeWatchlistEntry', () => {
  it('removes case-insensitively and leaves other entries alone', () => {
    addWatchlistEntry(CHECKSUMMED);
    addWatchlistEntry(OTHER);

    expect(removeWatchlistEntry(CHECKSUMMED.toLowerCase())).toEqual([OTHER]);
    expect(readWatchlist()).toEqual([OTHER]);
  });

  it('is a no-op for an address that is not watched', () => {
    addWatchlistEntry(CHECKSUMMED);
    expect(removeWatchlistEntry(OTHER)).toEqual([CHECKSUMMED]);
  });
});
