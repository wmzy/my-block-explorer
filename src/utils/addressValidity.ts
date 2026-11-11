// Page-level address validity: the frontend twin of the server's
// getValidatedAddress (src/server/validation.ts) — both are thin skins
// over the shared two-tier verdict (utils/address.ts), so a bad address
// renders a single tier-specific guidance card instead of per-query
// error soup, and the frontend can never disagree with the server.
import { addressVerdict } from '@/utils/address';

export type AddressValidityTier = 'format' | 'checksum';

export type AddressValidity = { valid: true } | { valid: false; tier: AddressValidityTier };

export function checkAddressValidity(address: string): AddressValidity {
  const verdict = addressVerdict(address);
  // An invalid shape has no checksum to retry in lowercase, so checksum
  // guidance would be misleading for it — the tiers keep their distinct
  // guidance meaning.
  if (verdict.tier === 'invalid-shape') {
    return { valid: false, tier: 'format' };
  }
  if (verdict.tier === 'invalid-checksum') {
    return { valid: false, tier: 'checksum' };
  }
  return { valid: true };
}
