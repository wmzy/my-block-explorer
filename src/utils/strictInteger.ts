// Import-free strict integer parsing, shared by every consumer that must
// NOT pull the utils/validation module (which imports viem) into its own
// import graph — notably src/cli.ts, whose static imports are kept
// minimal on purpose: `my-block-explorer --help`, `--version` and
// `uninstall` must not construct the database adapter (its constructor
// mkdirs data/, fabricating the very thing uninstall measures).
//
// Same rule as utils/validation.ts, which is the canonical implementation
// for the server/frontend; this leaf is that rule without the viem import.
// utils/validation.ts re-exports it so there is exactly ONE definition.

/** A plain run of decimal digits — no sign, exponent, radix prefix or space. */
const DECIMAL_INTEGER = /^\d+$/;

/**
 * Parse a plain decimal integer, or null when the input is not one.
 * Numbers pass through when they are safe integers.
 *
 * parseInt() accepts a valid prefix and ignores the rest, so "12abc",
 * "0x1a", "1e5" and " 7 " all came back as 12/26/100000/7 — junk reached
 * the RPC layer and silently addressed the WRONG block, chain or port.
 */
export function parseStrictInteger(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value !== 'string' || !DECIMAL_INTEGER.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * A JSON-RPC hex QUANTITY (`0x`-prefixed, non-negative) as a safe
 * integer, or null when the value is not one. The canonical reader for
 * every eth_chainId/eth_blockNumber-style answer (the RPC tester, the
 * custom-chain probe, the wallet facade) — each used to carry its own
 * copy of this exact function.
 *
 * parseInt(value, 16) is not this: it accepts a valid prefix and ignores
 * the rest, so '0x1zz' read as 1 and '137abc' as 1276604 — a fabricated
 * chain id / block height that a probe would then compare against the
 * user's configuration and report as a match. BigInt first (quantities
 * are uint64 in JSON-RPC), then a safe-integer gate so a value past 2^53
 * is rejected rather than silently rounded.
 */
export function parseHexQuantity(value: unknown): number | null {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  const parsed = Number(BigInt(value));
  return Number.isSafeInteger(parsed) ? parsed : null;
}
