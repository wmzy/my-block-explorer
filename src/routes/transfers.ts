import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../server/logger';
import { getValidatedChainId, getValidatedAddress } from '../server/validation';
import { tokenTransferService } from '../services/TokenTransferService';
import { createRateLimiter } from '../middleware/rate-limit';
import { safeJsonResponse } from '../utils/serialization';
import { respondError } from '../utils/api-error';
import { parseStrictInteger } from '../utils/validation';

const logger = createLogger('transfers-routes');

const app = new Hono();

// Query params. Numeric fields parse STRICTLY: z.coerce.number() runs
// Number(), which accepts a valid prefix and reinterprets the rest
// ('0x10' -> 16, '1e2' -> 100, ' 7 ' -> 7), so a junk cursor silently
// paged to an offset the client never asked for. A supplied-but-invalid
// integer is a loud 400 (a wrong page is worse than an error — the same
// policy the address-transactions route applies); an ABSENT value still
// takes the documented default.
type StrictRead = { kind: 'absent' } | { kind: 'value'; value: number } | { kind: 'invalid' };
const readStrictInt = (raw: string | undefined): StrictRead => {
  if (raw === undefined || raw === '') return { kind: 'absent' };
  const parsed = parseStrictInteger(raw);
  return parsed === null ? { kind: 'invalid' } : { kind: 'value', value: parsed };
};

// The window keeps its documented fallback: a junk or out-of-range window
// degrades to the service's tiered default and the effective value is
// echoed back (a scan window is a discovery bound, not a page).
const windowSchema = z.coerce.number().int().min(1).max(50_000_000).optional().catch(undefined);
// Cache-bypass flag: only the exact literal '1' forces a re-scan; junk
// values ('true', '0', 'abc') degrade to a cache-serving read instead of
// 400ing, matching the fallback philosophy of the schema above.
const refreshSchema = z.literal('1').optional().catch(undefined);

// Scan filter shape. Unlike the numeric params, an explicit-but-unknown
// mode is REJECTED (400 invalid_mode) rather than degraded: silently
// falling back would answer a different question than the client asked
// (token-emitted vs address-participated rows), which no catch() default
// can disambiguate downstream.
const SCAN_MODES = ['token', 'participant'] as const;

// On-demand token transfer list (eth_getLogs sweep). Stateless and
// read-only: no auth gate, no DuckDB writes — symbol/decimals enrichment
// happens in the frontend. Each miss triggers a chunked public-RPC scan,
// so the endpoint is rate-limited per client.
const transfersRateLimiter = createRateLimiter({
  name: 'token-transfers',
  requestsPerMinute: 10,
  burst: 3,
});
app.get('/chains/:chainId/addresses/:address/transfers', transfersRateLimiter, async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  const rawCursor = readStrictInt(c.req.query('cursor'));
  if (rawCursor.kind === 'invalid') {
    return c.json(
      { error: 'invalid_cursor', message: 'cursor must be a non-negative integer' },
      400,
    );
  }
  const cursor = rawCursor.kind === 'value' ? rawCursor.value : 0;

  const rawLimit = readStrictInt(c.req.query('limit'));
  if (rawLimit.kind === 'invalid' || (rawLimit.kind === 'value' && rawLimit.value < 1)) {
    return c.json(
      { error: 'invalid_limit', message: 'limit must be a positive integer' },
      400,
    );
  }
  const limit = rawLimit.kind === 'value' ? Math.min(rawLimit.value, 100) : 25;

  const windowBlocks = windowSchema.parse(c.req.query('window'));
  const refresh = refreshSchema.parse(c.req.query('refresh')) === '1';
  // Absent → participant (the pre-token-mode behavior). An explicit value
  // must be exactly one of the known modes.
  const rawMode = c.req.query('mode');
  if (rawMode !== undefined && !(SCAN_MODES as readonly string[]).includes(rawMode)) {
    return respondError(
      c,
      400,
      'invalid_mode',
      `Invalid mode "${rawMode}" — expected "token" or "participant"`,
    );
  }
  const mode = rawMode === 'token' ? 'token' : 'participant';

  try {
    const result = await tokenTransferService.getTokenTransfers(
      chainId,
      address,
      cursor,
      limit,
      windowBlocks,
      refresh,
      mode,
    );

    const responseData = safeJsonResponse({
      transfers: result.transfers,
      nextCursor: result.nextCursor,
      coverage: result.coverage,
      windowBlocks: result.windowBlocks,
      // First-scan time of the cache entry (freshness for the client's
      // 'Scanned X ago'); additive field — older clients ignore it.
      scannedAt: result.scannedAt,
      // Which filter shape produced these rows; additive like scannedAt.
      mode: result.mode,
    });

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error }, 'Token transfers API error');
    return respondError(c, 500, 'internal_error', 'Failed to get token transfers');
  }
});

export default app;
