import { Hono } from 'hono';
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { eq } from 'drizzle-orm';
import { createLogger } from '../server/logger';
import { db, userRpcConfigs } from '../database/init';

const logger = createLogger('rpc-config-routes');
import { rpcManager } from '../services/RpcManager';
import { getChainInfo } from '../config/chains';
import { getValidatedChainId } from '../server/validation';
import { requireAdminTokenIfConfigured } from '../middleware/admin-token';
import { isAllowedCorsOrigin } from '../middleware/cors-origins';
import { respondError } from '../utils/api-error';

const app = new Hono();

// Custom endpoint URLs routinely embed provider API keys in the path or
// query (the RPC config modal invites exactly that), so they are secrets
// despite sitting in a "URL" field. Redact to scheme + host; a URL that
// does not parse degrades to an opaque marker rather than leaking.
function redactUrl(url: string): string {
  try {
    const { protocol, host } = new URL(url);
    return `${protocol}//${host}/…`;
  } catch {
    return '…';
  }
}

// Origin-less requests cannot lean on CORS — browsers always send Origin on
// cross-origin reads, so "no Origin" mostly means scripts (curl, anything
// HTTP-capable), not a trusted same-origin reader. The one unforgeable
// signal left is the socket: only loopback callers (127.0.0.0/8, ::1,
// including the ::ffff:-mapped IPv4 form Node reports on dual-stack
// listeners) keep seeing full URLs. Runtimes without socket info (the
// in-process Vite dev bridge) and any parse surprise fail closed.
function isLoopbackRemote(c: Context): boolean {
  try {
    const address = getConnInfo(c).remote.address;
    if (!address) return false;
    const normalized = address.toLowerCase().replace(/^::ffff:/, '');
    return normalized === '::1' || /^127(?:\.\d{1,3}){3}$/.test(normalized);
  } catch {
    return false;
  }
}

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

    const origin = c.req.header('origin');
    const seesFullUrl = origin ? isAllowedCorsOrigin(origin) : isLoopbackRemote(c);

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
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return respondError(c, 400, 'invalid_json', 'Request body must be valid JSON');
  }
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

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return respondError(c, 400, 'invalid_url', 'url must be a valid absolute URL');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return respondError(c, 400, 'invalid_url', 'url must use the http or https protocol');
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
