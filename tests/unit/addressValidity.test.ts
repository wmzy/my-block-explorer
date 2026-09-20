// Pins the two-tier validity verdict the whole address page branches on
// (page-level guidance card, transfers-tab error handling). The contract
// mirrors the server's getValidatedAddress exactly — a frontend-only
// rejection of a server-legal form (or vice versa) would split the screen
// into conflicting verdicts again.
import { describe, it, expect } from 'vitest';
import { getAddress } from 'viem';
import { checkAddressValidity } from '@/views/Address/addressValidity';

describe('checkAddressValidity', () => {
  const lower = '0x1234567890abcdef1234567890abcdef12345678';
  const checksummed = getAddress(lower);

  it('rejects a malformed shape as the format tier', () => {
    // Non-hex characters, wrong length, missing prefix — none of these
    // has a checksum to retry in lowercase, so the tier must be format
    // (checksum advice would be misleading).
    expect(checkAddressValidity(`0xGG${'11'.repeat(19)}`)).toEqual({
      valid: false,
      tier: 'format',
    });
    expect(checkAddressValidity('0x123')).toEqual({ valid: false, tier: 'format' });
    expect(checkAddressValidity('1234567890abcdef1234567890abcdef12345678')).toEqual({
      valid: false,
      tier: 'format',
    });
    expect(checkAddressValidity('')).toEqual({ valid: false, tier: 'format' });
  });

  it('rejects a mixed-case address that disagrees with its EIP-55 checksum', () => {
    // Uppercase one body position where the checksum form says lowercase:
    // mixed case, provably != getAddress of itself (viem's getAddress
    // would silently correct it — the exact trap this tier exists for).
    let bad = '';
    for (let i = 2; i < checksummed.length; i++) {
      if (/[a-f]/.test(checksummed[i])) {
        bad = lower.slice(0, i) + lower[i].toUpperCase() + lower.slice(i + 1);
        break;
      }
    }
    expect(bad).not.toBe('');
    expect(bad).not.toBe(checksummed);
    expect(checkAddressValidity(bad)).toEqual({ valid: false, tier: 'checksum' });
  });

  it('accepts the all-lowercase form (checksum-less convention)', () => {
    expect(checkAddressValidity(lower)).toEqual({ valid: true });
  });

  it('accepts a correct EIP-55 checksum', () => {
    expect(checkAddressValidity(checksummed)).toEqual({ valid: true });
  });

  it('accepts the all-uppercase form (checksum-less convention, server parity)', () => {
    // getValidatedAddress lets single-case addresses pass through
    // normalized; the frontend check must agree or an all-upper deep link
    // would render guidance while the server serves data.
    expect(checkAddressValidity(`0x${lower.slice(2).toUpperCase()}`)).toEqual({
      valid: true,
    });
  });
});
