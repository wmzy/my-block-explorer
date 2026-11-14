import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createLogger } from '../server/logger';
import { db, userRpcConfigs } from '../database/init';

const logger = createLogger('rpc-config-routes');
import { rpcManager } from '../services/RpcManager';
import { getChainInfo } from '../config/chains';
import { getValidatedChainId } from '../server/validation';
import { requireAdminTokenIfConfigured } from '../middleware/admin-token';
import { redactUrl, requestSeesFullUrl } from '../middleware/rpc-url-visibility';
import { readJsonBody, respondError } from '../utils/api-error';
import { parseHttpUrl } from '../utils/validation';

const app = new Hono();

// Reads are open (the RPC config modal needs them without an admin
// token), but the full URL only goes to readers the CORS policy already
// trusts: allowlisted Origins (loopback + operator-configured extras,
// decided by the shared cors-origins policy), or Origin-less requests
// coming from a loopback socket (local curl, same-host scripts).
// Everything else — foreign Origins, and remote Origin-less clients for
// which CORS never applied — gets scheme + host, so a leak cannot
// disclose the key. `urlRedacted` tells the reader which form it got;
// the isCustom flag and the rest of the shape are identical for both.
app.get('/rpc-configs', async c => {
  try {
    const configs = await db.select().from(userRpcConfigs);

    const seesFullUrl = requestSeesFullUrl(c);

    return c.json({
      configs: configs.map(config => ({
        id: config.chainId.toString(),
        chainId: config.chainId,
        name: config.name,
        url: config.url ? (seesFullUrl ? config.url : redactUrl(config.url)) : null,
        urlRedacted: config.url !== null && !seesFullUrl,
        isCustom: true,
        supportsHistory: config.supportsHistory,
        maxEventRange: config.maxEventRange,
      })),
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to get RPC configs');
    return respondError(c, 500, 'internal_error', 'Failed to get RPC configs');
  }
});

// Writes use the opt-in gate: without ADMIN_TOKEN a local session can
// still save its RPC config; with one configured, writes require it.
app.post('/rpc-configs', requireAdminTokenIfConfigured, async c => {
  const body = await readJsonBody<Record<string, unknown>>(c);
  // Destructured from Record<string, unknown>: every field is unknown and
  // must earn its type through the guards below.
  const { chainId, name, url, supportsHistory, maxEventRange } = body;

  if (!chainId || !name || !url) {
    return respondError(c, 400, 'missing_fields', 'chainId, name and url are required');
  }

  if (typeof chainId !== 'number' || !Number.isInteger(chainId) || chainId <= 0) {
    return respondError(c, 400, 'invalid_chain_id', 'chainId must be a positive integer');
  }

  if (typeof name !== 'string') {
    return respondError(c, 400, 'invalid_name', 'name must be a string');
  }

  // The saved config feeds an RPC client for the chain, so the chain must
  // actually be resolvable in the chain registry.
  if (!getChainInfo(chainId)) {
    return respondError(
      c,
      400,
      'invalid_chain_id',
      `chainId ${chainId} is not a supported chain`,
    );
  }

  if (typeof url !== 'string') {
    return respondError(c, 400, 'invalid_url', 'url must be a string');
  }

  const parsedUrl = parseHttpUrl(url);
  if (!parsedUrl.ok) {
    return respondError(
      c,
      400,
      'invalid_url',
      parsedUrl.reason === 'protocol'
        ? 'url must use the http or https protocol'
        : 'url must be a valid absolute URL',
    );
  }

  if (
    (supportsHistory !== undefined && typeof supportsHistory !== 'boolean') ||
    (maxEventRange !== undefined &&
      (typeof maxEventRange !== 'number' || !Number.isInteger(maxEventRange) || maxEventRange <= 0))
  ) {
    return respondError(
      c,
      400,
      'invalid_fields',
      'supportsHistory must be a boolean and maxEventRange a positive integer when present',
    );
  }

  try {
    const existing = await db
      .select({ chainId: userRpcConfigs.chainId })
      .from(userRpcConfigs)
      .where(eq(userRpcConfigs.chainId, chainId));

    const action = existing.length > 0 ? 'replaced' : 'created';

    if (existing.length > 0) {
      await db
        .update(userRpcConfigs)
        .set({
          name,
          url,
          supportsHistory,
          maxEventRange,
          updatedAt: new Date(),
        })
        .where(eq(userRpcConfigs.chainId, chainId));
    } else {
      await db.insert(userRpcConfigs).values({
        chainId,
        name,
        url,
        supportsHistory,
        maxEventRange,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await rpcManager.reloadConfigs();

    return c.json({ success: true, action });
  } catch (error) {
    logger.error(
      { err: error, stack: error instanceof Error ? error.stack : undefined },
      'Failed to save RPC config',
    );
    return respondError(c, 500, 'internal_error', 'Failed to save RPC config');
  }
});

app.delete('/rpc-configs/:chainId', requireAdminTokenIfConfigured, async c => {
  try {
    const chainId = getValidatedChainId(c.req.param('chainId'));

    await db.delete(userRpcConfigs).where(eq(userRpcConfigs.chainId, chainId));

    await rpcManager.reloadConfigs();

    return c.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Failed to delete RPC config');
    return respondError(c, 500, 'internal_error', 'Failed to delete RPC config');
  }
});

export default app;
