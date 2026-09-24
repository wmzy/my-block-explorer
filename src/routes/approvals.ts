import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../server/logger';
import {
  getValidatedChainId,
  getValidatedAddress,
} from '../server/validation';
import { approvalScanService } from '../services/ApprovalScanService';
import { createRateLimiter } from '../middleware/rate-limit';
import { safeJsonResponse } from '../utils/serialization';

const logger = createLogger('approvals-routes');

const app = new Hono();

// Query params. catch() keeps the documented fallback on junk input
// ('abc', out-of-range numbers) instead of 400ing — the transfers route's
// window philosophy: windowBlocks clamps into 1..50M at the schema
// (min(1)/max(50M) failures degrade to the default window, and the
// service echoes the effective value).
const windowSchema = z.coerce.number().int().min(1).max(50_000_000).optional().catch(undefined);
// Cache-bypass flag: only the exact literal '1' forces a re-scan; junk
// values ('true', '0', 'abc') degrade to a cache-serving read instead of
// 400ing, matching the fallback philosophy of the schema above.
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
const approvalsRateLimiter = createRateLimiter({ name: 'address-approvals', requestsPerMinute: 10, burst: 3 });
app.get('/chains/:chainId/addresses/:address/approvals', approvalsRateLimiter, async (c) => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  const windowBlocks = windowSchema.parse(c.req.query('window'));
  const refresh = refreshSchema.parse(c.req.query('refresh')) === '1';

  try {
    const result = await approvalScanService.getApprovals(
      chainId,
      address,
      windowBlocks,
      refresh,
    );

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
  }
  catch (error) {
    logger.error({ err: error }, 'Approvals API error');
    return c.json({ error: 'Failed to get approvals' }, 500);
  }
});

export default app;
