import { Hono } from 'hono';
import { createLogger } from '../server/logger';
import { rpcManager } from '../services/RpcManager';
import { storageLayoutService } from '../services/StorageLayoutService';
import { getChainName } from '../config/chains';
import { getValidatedChainId, getValidatedAddress } from '../server/validation';
import { safeJsonResponse } from '../utils/serialization';
import { respondError } from '../utils/api-error';
import { requireAdminTokenIfConfigured } from '../middleware/admin-token';

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

app.get('/chains/:chainId/contracts/:address/storage/:slot', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));
  const slotParam = c.req.param('slot');

  let slot: `0x${string}`;
  if (slotParam.startsWith('0x')) {
    if (!/^0x[0-9a-fA-F]*$/.test(slotParam)) {
      return respondError(c, 400, 'invalid_slot', 'Invalid slot: must be valid hex string');
    }
    slot = slotParam as `0x${string}`;
  } else {
    // Non-hex slots are decimal integers; junk like 'abc' or '1.5' makes
    // BigInt() throw, which would escape as a generic 500 — answer with
    // the same 400 contract as the hex branch above.
    let slotNumber: bigint;
    try {
      slotNumber = BigInt(slotParam);
    } catch {
      return respondError(c, 400, 'invalid_slot', 'Invalid slot: must be a decimal integer');
    }
    if (slotNumber < 0n) {
      return respondError(c, 400, 'invalid_slot', 'Invalid slot: must be non-negative');
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
