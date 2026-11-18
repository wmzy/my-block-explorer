import { Hono } from 'hono';
import { createLogger } from '../server/logger';
import { rpcManager } from '../services/RpcManager';
import { storageLayoutService } from '../services/StorageLayoutService';
import { getChainName } from '../config/chains';
import { getValidatedChainId, getValidatedAddress } from '../server/validation';
import { safeJsonResponse } from '../utils/serialization';
import { respondError } from '../utils/api-error';
import { parseDecimalBigInt } from '../utils/strictInteger';
import { requireAdminTokenIfConfigured } from '../middleware/admin-token';
import { createRateLimiter } from '../middleware/rate-limit';

const logger = createLogger('storage-routes');

const app = new Hono();

app.get('/chains/:chainId/contracts/:address/storage-layout', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  try {
    const result = await storageLayoutService.getStorageLayout(chainId, address);

    if (!result.found) {
      return respondError(
        c,
        404,
        'storage_layout_not_found',
        result.error ?? 'Contract may not be verified or storage layout not available',
      );
    }

    c.header('X-Data-Source', result.source ?? 'unknown');
    c.header('X-Chain-Name', getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address,
      found: true,
      layout: result.layout,
      source: result.source,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error, chainId, address }, 'Storage layout API error');
    return respondError(c, 500, 'internal_error', 'Failed to get storage layout');
  }
});

// Opt-in admin gate: clearCache deletes unconditionally and treats a
// missing entry as a no-op, so a 200 is returned even when nothing was
// cached for the pair. The cleared layout is immutable upstream, so the
// delete is non-destructive and a zero-config session stays functional.
app.delete(
  '/chains/:chainId/contracts/:address/storage-layout/cache',
  requireAdminTokenIfConfigured,
  async c => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    try {
      await storageLayoutService.clearCache(chainId, address);

      return c.json({ success: true, message: 'Storage layout cache cleared' });
    } catch (error) {
      logger.error({ err: error, chainId, address }, 'Clear storage layout cache API error');
      return respondError(c, 500, 'internal_error', 'Failed to clear storage layout cache');
    }
  },
);

// One live eth_getStorageAt RPC per request — the same exposure class as
// the contract read/simulate routes, so it gets its own bucket (the
// documented public API still pols freely; a runaway loop does not).
const storageReadRateLimiter = createRateLimiter({
  name: 'storage-read',
  requestsPerMinute: 60,
  burst: 20,
});
app.get('/chains/:chainId/contracts/:address/storage/:slot', storageReadRateLimiter, async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));
  const slotParam = c.req.param('slot');

  let slot: `0x${string}`;
  if (slotParam.startsWith('0x')) {
    // `+` not `*`: bare '0x' (the empty hex string) is not a slot. The
    // canonical strict-shape family (strictInteger's hex-quantity regex)
    // rejects it everywhere else.
    if (!/^0x[0-9a-fA-F]+$/.test(slotParam)) {
      return respondError(c, 400, 'invalid_slot', 'Invalid slot: must be valid hex string');
    }
    slot = slotParam as `0x${string}`;
  } else {
    // Non-hex slots are strict decimal integers. Raw BigInt() would also
    // accept '+7', surrounding whitespace and 0x/0o/0b prefixed forms —
    // the exact junk class the canonical parseDecimalBigInt exists to
    // reject; junk answers the same 400 contract as the hex branch.
    const slotNumber = parseDecimalBigInt(slotParam);
    if (slotNumber === null) {
      return respondError(c, 400, 'invalid_slot', 'Invalid slot: must be a decimal integer');
    }
    slot = `0x${slotNumber.toString(16)}`;
  }

  try {
    const client = await rpcManager.getClient(chainId);
    const value = await client.getStorageAt({
      address,
      slot,
    });

    c.header('X-Data-Source', 'rpc');
    c.header('X-Chain-Name', getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address,
      slot,
      value,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error, chainId, address, slot }, 'Storage slot read API error');
    return respondError(c, 500, 'internal_error', 'Failed to read storage slot');
  }
});

export default app;
