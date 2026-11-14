// Route-param parsing for the :chainId and :blockNumber URL segments.
// Number() and parseInt both accept far more than these routes mean
// ("0x1a" → 26, "1e5" → 100000, " 12", "+3"), which either surfaced as a
// bare NaN in the UI or silently loaded the wrong block. These parsers
// delegate the strict plain-decimal-digits walk to parseStrictInteger
// (the ONE documented home, same directory, import-free) and add only
// their per-param range gates.

import { parseStrictInteger } from './strictInteger';

/**
 * Parse a :chainId route param: a plain decimal integer > 0, else null.
 */
export function parseChainIdParam(raw: string | undefined): number | null {
  const parsed = parseStrictInteger(raw);
  return parsed !== null && parsed > 0 ? parsed : null;
}

/**
 * Parse a :blockNumber route param: a plain decimal integer >= 0 (block 0
 * is genesis), else null.
 */
export function parseBlockNumberParam(raw: string | undefined): number | null {
  const parsed = parseStrictInteger(raw);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

/**
 * The two-tier chain-id guard the un-scoped mainnet routes share: no
 * :chainId param at all means mainnet (id 1); a parseable id resolves as
 * itself; anything malformed parses to null and parks the view on 0 (the
 * guarded id that renders the unsupported state without RPC traffic) —
 * never a wrong chain.
 */
export function resolveMainnetDefaultChainId(raw: string | undefined): number {
  return (raw === undefined ? 1 : parseChainIdParam(raw)) ?? 0;
}
