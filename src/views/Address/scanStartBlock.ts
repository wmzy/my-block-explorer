// Start-block parsing for the address deep-scan panel.
//
// The field was read with Number(), which accepts a valid prefix and
// reinterprets the rest: '0x1a' became 26 and '1e5' became 100000, and
// both passed the Number.isInteger guard, so the panel POSTed a start
// block the user never typed while reporting the field as valid. An
// unsafe integer (1e23) also passed and reached the API as an imprecise
// float. The repo's parseStrictInteger (plain /^\d+$/ only) is the
// convention for exactly this input; 'earliest' remains the empty-field
// default the POST body omits.

import { parseStrictInteger } from '@/utils/validation';

export type ScanStartBlock =
  | { ok: true; value: 'earliest' }
  | { ok: true; value: number }
  | { ok: false };

/**
 * Parse the deep-scan start-block input: blank means 'earliest' (the
 * POST body omits the field), a plain decimal integer >= 0 is the block,
 * anything else is invalid.
 */
export function parseScanStartBlock(raw: string): ScanStartBlock {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: 'earliest' };
  const parsed = parseStrictInteger(trimmed);
  if (parsed === null || parsed < 0) return { ok: false };
  return { ok: true, value: parsed };
}
