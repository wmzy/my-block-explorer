import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createLogger } from '../server/logger';
import { db, userRpcConfigs } from '../database/init';

const logger = createLogger('rpc-config-routes');
import { rpcManager } from '../services/RpcManager';
import { getValidatedChainId } from '../server/validation';
import { requireAdminTokenIfConfigured } from '../middleware/admin-token';
import { isAllowedCorsOrigin } from '../middleware/cors-origins';

const app = new Hono();

// Custom endpoint URLs routinely embed provider API keys in the path or
// query (the RPC config modal invites exactly that), so they are secrets
// despite sitting in a "URL" field. Redact to scheme + host; a URL that
// does not parse degrades to an opaque marker rather than leaking.
function redactUrl(url: string): string {
  try {
    const { protocol, host } = new URL(url);
    return `${protocol}//${host}/…`;
  }
  catch {
    return '…';
  }
}

// Reads are open (the RPC config modal needs them without an admin
// token), but the full URL only goes to readers the CORS policy already
// trusts: requests with no Origin header (same-origin UI, curl) and
// allowlisted origins (loopback + operator-configured extras, decided by
// the shared cors-origins policy). Any other Origin — which could only
// read the response through a CORS misconfiguration — gets scheme +
// host, so a leak cannot disclose the key. The isCustom flag and the
// rest of the shape are identical for both readers.
app.get('/rpc-configs', async (c) => {
  try {
    const configs = await db.select().from(userRpcConfigs);

    const origin = c.req.header('origin');
    const seesFullUrl = !origin || isAllowedCorsOrigin(origin);

    return c.json({
      configs: configs.map(config => ({
        id: config.chainId.toString(),
        chainId: config.chainId,
        name: config.name,
        url: config.url ? (seesFullUrl ? config.url : redactUrl(config.url)) : null,
        isCustom: true,
        supportsHistory: config.supportsHistory,
        maxEventRange: config.maxEventRange,
      })),
    });
  }
  catch (error) {
    logger.error({ err: error }, 'Failed to get RPC configs');
    return c.json({ error: 'Failed to get RPC configs' }, 500);
  }
});

// Writes use the opt-in gate: without ADMIN_TOKEN a local session can
// still save its RPC config; with one configured, writes require it.
app.post('/rpc-configs', requireAdminTokenIfConfigured, async (c) => {
  try {
    const body = await c.req.json();
    const { chainId, name, url, supportsHistory, maxEventRange } = body;

    if (!chainId || !name || !url) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    const existing = await db
      .select({ chainId: userRpcConfigs.chainId })
      .from(userRpcConfigs)
      .where(eq(userRpcConfigs.chainId, chainId));

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
    }
    else {
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

    return c.json({ success: true });
  }
  catch (error) {
    logger.error(
      { err: error, stack: error instanceof Error ? error.stack : undefined },
      'Failed to save RPC config',
    );
    return c.json({ error: 'Failed to save RPC config' }, 500);
  }
});

app.delete('/rpc-configs/:chainId', requireAdminTokenIfConfigured, async (c) => {
  try {
    const chainId = getValidatedChainId(c.req.param('chainId'));

    await db.delete(userRpcConfigs).where(eq(userRpcConfigs.chainId, chainId));

    await rpcManager.reloadConfigs();

    return c.json({ success: true });
  }
  catch (error) {
    logger.error({ err: error }, 'Failed to delete RPC config');
    return c.json({ error: 'Failed to delete RPC config' }, 500);
  }
});

export default app;
