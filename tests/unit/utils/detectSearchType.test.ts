// Search-type detection contract: ENS classification follows ENSIP-15
// (viem's normalize) — the full Unicode name space (IDN labels, emoji) is
// recognized, malformed names stay 'unknown', and the ASCII path is
// unchanged. Address/hash/block classification is pinned only where it
// borders ENS names (a .eth-suffixed string is never a hash).
import { describe, it, expect } from 'vitest';
import { detectSearchType } from '@/utils/validation';

const ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const TX_HASH = '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060';

describe('detectSearchType', () => {
  it('classifies addresses, hashes and block numbers', () => {
    expect(detectSearchType(ADDRESS)).toBe('address');
    expect(detectSearchType(TX_HASH)).toBe('hash');
    expect(detectSearchType('18000000')).toBe('block');
    expect(detectSearchType('')).toBe('unknown');
  });

  it('recognizes non-ASCII ENS names per ENSIP-15', () => {
    // IDN labels, umlauts and emoji are valid ENS names — an ASCII-only
    // regex used to reject them as 'unknown'.
    expect(detectSearchType('日本.eth')).toBe('ens');
    expect(detectSearchType('übär.eth')).toBe('ens');
    expect(detectSearchType('😀.eth')).toBe('ens');
  });

  it('keeps the ASCII ENS path unchanged', () => {
    expect(detectSearchType('vitalik.eth')).toBe('ens');
    expect(detectSearchType('a.b.eth')).toBe('ens');
    expect(detectSearchType('VITALIK.ETH')).toBe('ens');
  });

  it('keeps malformed names unknown', () => {
    // Empty labels and invalid punycode throw inside normalize; a bare
    // label without a TLD never reaches ENS detection at all.
    expect(detectSearchType('not-a-valid..eth')).toBe('unknown');
    expect(detectSearchType('xn--fiqs8s.eth')).toBe('unknown');
    expect(detectSearchType('.eth')).toBe('unknown');
    expect(detectSearchType('vitalik')).toBe('unknown');
    expect(detectSearchType('not a name.eth')).toBe('unknown');
  });

  it('trims surrounding whitespace before classifying', () => {
    expect(detectSearchType('  vitalik.eth  ')).toBe('ens');
    expect(detectSearchType(`  ${TX_HASH}  `)).toBe('hash');
  });
});
