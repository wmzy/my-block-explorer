// Shared scan-route query params: the exact-literal '?refresh=1'
// cache-bypass flag and the tri-kind strict-int reader. Extracted from
// the verbatim twins routes/transfers.ts and routes/approvals.ts carried
// (2026-11-10 dedup wave); the route suites pin the wiring, the module
// test pins this contract.
//
// Import-free besides the strictInteger leaf — safe from any graph.
import { z } from 'zod';

import { parseStrictInteger } from './strictInteger';

// The flag's own documented convention: ONLY the exact literal '1' means
// "bypass the ~60s scan cache and genuinely re-scan". Every other
// spelling (including 'true', '01', whitespace) degrades to a
// cache-serving read — a stale-looking retry must never become a
// different operation than the one the user clicked.
export const refreshSchema = z.literal('1').optional().catch(undefined);

// Tri-kind strict decimal parse: absent (missing/empty), value (plain
// decimal integer), invalid (everything else — hex/exponent/signed/
// padded/junk are never silently reinterpreted as a different number).
export type StrictIntRead =
  | { kind: 'absent' }
  | { kind: 'value'; value: number }
  | { kind: 'invalid' };

export function readStrictInt(raw: string | undefined): StrictIntRead {
  if (raw === undefined || raw === '') return { kind: 'absent' };
  const parsed = parseStrictInteger(raw);
  return parsed === null ? { kind: 'invalid' } : { kind: 'value', value: parsed };
}
