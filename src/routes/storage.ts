import { Hono } from 'hono';
import type { Address } from 'viem';
import { createLogger } from '../server/logger';
import type { StorageLayoutResponse } from '../types/storage';
import { rpcManager } from '../services/RpcManager';
import { storageLayoutService } from '../services/StorageLayoutService';
import { getChainName } from '../config/chains';
import { getValidatedChainId, getValidatedAddress } from '../server/validation';
import { safeJsonResponse } from '../utils/serialization';

const logger = createLogger('storage-routes');

const app = new Hono();

app.get('/chains/:chainId/contracts/:address/storage-layout', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  try {
    const result = await storageLayoutService.getStorageLayout(chainId, address);

    if (!result.found) {
      return c.json(
        {
          error: 'Storage layout not found',
          message: result.error ?? 'Contract may not be verified or storage layout not available',
        },
        404,
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
    return c.json({ error: 'Failed to get storage layout' }, 500);
  }
});

app.get('/chains/:chainId/contracts/:address/storage/:slot', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));
  const slotParam = c.req.param('slot');

  let slot: `0x${string}`;
  if (slotParam.startsWith('0x')) {
    if (!/^0x[0-9a-fA-F]*$/.test(slotParam)) {
      return c.json({ error: 'Invalid slot: must be valid hex string' }, 400);
    }
    slot = slotParam as `0x${string}`;
  } else {
    const slotNumber = BigInt(slotParam);
    if (slotNumber < 0n) {
      return c.json({ error: 'Invalid slot: must be non-negative' }, 400);
    }
    slot = `0x${slotNumber.toString(16)}` as `0x${string}`;
  }

  try {
    const client = await rpcManager.getClient(chainId);
    const value = await client.getStorageAt({
      address: address as Address,
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
    return c.json({ error: 'Failed to read storage slot' }, 500);
  }
});

export default app;
