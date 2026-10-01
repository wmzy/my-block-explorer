import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../server/logger';
import { getValidatedChainId, getValidatedAddress } from '../server/validation';
import { approvalScanService } from '../services/ApprovalScanService';
import { createRateLimiter } from '../middleware/rate-limit';
import { safeJsonResponse } from '../utils/serialization';
import { respondError } from '../utils/api-error';
import { parseStrictInteger } from '../utils/validation';

const logger = createLogger('approvals-routes');

const app = new Hono();

// Query params. The window keeps its documented degrade-to-default
// policy (junk and out-of-range fall back to the service's tiered
// default, which is echoed back) — a scan window is a discovery bound,
// not a page. What changes is the PARSE: the old z.coerce.number() ran
// Number(), which accepts a valid prefix and reinterprets the rest, so
// '0x10' became 16 and '1e5' became 100000 — a junk window silently swept
// a range the client never asked for. parseStrictInteger accepts plain
// decimal digits only, so those now degrade like any other junk.
const MAX_WINDOW_BLOCKS = 50_000_000;
const readWindow = (raw: string | undefined): number | undefined => {
  if (raw === undefined || raw === '') return undefined;
  const parsed = parseStrictInteger(raw);
  if (parsed === null || parsed < 1 || parsed > MAX_WINDOW_BLOCKS) return undefined;
  return parsed;
};
// Cache-bypass flag: only the exact literal '1' forces a re-scan; junk
// values ('true', '0', 'abc') degrade to a cache-serving read instead of
// 400ing, matching the flag's own documented convention.
const refreshSchema = z.literal('1').optional().catch(undefined);

// On-demand approvals discovery (owner-filtered approval-event
// eth_getLogs sweep — ERC-20/ERC-721 Approval + ERC-1155
// ApprovalForAll — plus Multicall3 current-state reads per kind).
// Stateless and read-only: no auth gate, no DuckDB writes —
// symbol/decimals enrichment happens in the frontend. Each miss
// triggers a chunked public-RPC scan, so the endpoint is rate-limited
// per client with the same 10/min burst-3 configuration family as the
// address-tx and token-transfers scan routes (its own bucket name, so
// opening this section never eats the tx list's allowance).
const approvalsRateLimiter = createRateLimiter({
  name: 'address-approvals',
  requestsPerMinute: 10,
  burst: 3,
});
app.get('/chains/:chainId/addresses/:address/approvals', approvalsRateLimiter, async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  const windowBlocks = readWindow(c.req.query('window'));
  const refresh = refreshSchema.parse(c.req.query('refresh')) === '1';

  try {
    const result = await approvalScanService.getApprovals(chainId, address, windowBlocks, refresh);

    // Honesty fields are the contract the view renders: coverage is
    // window-scoped (never full-history), pairCount is the pre-cap
    // discovery total across ALL approval kinds, truncated says the
    // current-state reads were capped, and reason names a
    // discovery-without-current-values degrade. `history`/
    // `historyTruncated` (the raw events the same sweep retained,
    // newest-first, capped) are ADDITIVE: absent entirely when the scan
    // saw no events, so existing consumers keep their exact shape.
    const responseData = safeJsonResponse({
      chainId,
      address,
      approvals: result.approvals,
      // First-scan time of the cache entry (freshness for the client's
      // 'Scanned X ago'); a cache hit does not reset it.
      scannedAt: result.scannedAt,
      windowBlocks: result.windowBlocks,
      coverage: result.coverage,
      pairCount: result.pairCount,
      truncated: result.truncated,
      ...(result.history.length > 0
        ? { history: result.history, historyTruncated: result.historyTruncated }
        : {}),
      ...(result.reason !== undefined ? { reason: result.reason } : {}),
    });

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error }, 'Approvals API error');
    return respondError(c, 500, 'internal_error', 'Failed to get approvals');
  }
});

export default app;
