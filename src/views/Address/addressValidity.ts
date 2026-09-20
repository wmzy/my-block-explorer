// Page-level address validity: the frontend twin of the server's
// getValidatedAddress (src/server/validation.ts) — the same two tiers and
// the same precedence. Shape first (0x + 40 hex chars), then the EIP-55
// checksum, which only a MIXED-case address carries (all-lowercase and
// all-uppercase are the checksum-less pass-through convention). Every
// address-page surface branches on this ONE verdict so a bad address
// renders a single tier-specific guidance card instead of per-query
// error soup.
import { getAddress } from 'viem';

export type AddressValidityTier = 'format' | 'checksum';

export type AddressValidity =
  | { valid: true }
  | { valid: false; tier: AddressValidityTier };

// 0x-prefixed, 40 hex characters — the shape both tiers below assume.
const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function checkAddressValidity(address: string): AddressValidity {
  // Tier 1 — shape: wrong length or non-hex characters. An address
  // without this shape has no checksum to retry in lowercase, so
  // checksum guidance would be misleading for it.
  if (!HEX_ADDRESS_RE.test(address)) {
    return { valid: false, tier: 'format' };
  }
  // Tier 2 — checksum. viem's getAddress SILENTLY checksum-corrects any
  // hex-shaped input, so the check is an explicit comparison against the
  // ORIGINAL string — and only a mixed-case body carries checksum
  // information at all.
  const body = address.slice(2);
  const isMixedCase = /[a-f]/.test(body) && /[A-F]/.test(body);
  if (isMixedCase && address !== getAddress(address)) {
    return { valid: false, tier: 'checksum' };
  }
  return { valid: true };
}
