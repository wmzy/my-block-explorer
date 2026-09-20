// Route-param parsing for the :chainId and :blockNumber URL segments.
// Number() and parseInt both accept far more than these routes mean
// ("0x1a" → 26, "1e5" → 100000, " 12", "+3"), which either surfaced as a
// bare NaN in the UI or silently loaded the wrong block. These parsers
// accept plain decimal digits only and stay honest otherwise.

const DECIMAL_INTEGER = /^\d+$/;

/**
 * Parse a :chainId route param: a plain decimal integer > 0, else null.
 */
export function parseChainIdParam(raw: string | undefined): number | null {
  if (raw === undefined || !DECIMAL_INTEGER.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Parse a :blockNumber route param: a plain decimal integer >= 0 (block 0
 * is genesis), else null.
 */
export function parseBlockNumberParam(raw: string | undefined): number | null {
  if (raw === undefined || !DECIMAL_INTEGER.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
