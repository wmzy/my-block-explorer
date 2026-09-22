// Custom-chain registration routes: let the explorer follow an RPC into
// any EVM chain viem's registry does not ship (anvil 31337, hardhat
// forks, private geth, new L2s). POST probes the endpoint's eth_chainId
// with a raw JSON-RPC request — no shared viem client, because the chain
// is not resolvable yet and a probe must not end up in the manager's
// client cache — 409s when viem already knows the reported id (the ⚙ RPC
// override panel is the right tool for known chains), then persists the
// row, registers it in the runtime registry, and hot-reloads the RPC
// manager so the chain is served immediately. GET applies the same
// URL-secret redaction policy as routes/rpc-config.ts.
import { Hono } from 'hono';
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { eq } from 'drizzle-orm';
import { createLogger } from '../server/logger';
import { db, customChains } from '../database/init';
import { rpcManager } from '../services/RpcManager';
import { getBuiltInChainInfo, isBuiltInChainProtected } from '../config/chains';
import { registerCustomChain, removeCustomChain } from '../config/customChains';
import { requireAdminTokenIfConfigured } from '../middleware/admin-token';
import { createRateLimiter } from '../middleware/rate-limit';
import { isAllowedCorsOrigin } from '../middleware/cors-origins';

const logger = createLogger('custom-chain-routes');

const app = new Hono();

// Same URL-secret policy as routes/rpc-config.ts: registration URLs can
// embed provider API keys in the path or query, so they are secrets
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

// Origin-less requests cannot lean on CORS — the socket is the only
// unforgeable trust signal left for them (see rpc-config.ts for the full
// rationale). Runtimes without socket info fail closed.
function isLoopbackRemote(c: Context): boolean {
  try {
    const address = getConnInfo(c).remote.address;
    if (!address) return false;
    const normalized = address.toLowerCase().replace(/^::ffff:/, '');
    return normalized === '::1' || /^127(?:\.\d{1,3}){3}$/.test(normalized);
  }
  catch {
    return false;
  }
}

// Probe budget: short — a dead endpoint must not hold the request (and
// its rate-limit token) hostage.
const PROBE_TIMEOUT_MS = 5000;

type ProbeResult =
  | { ok: true; chainId: number }
  | { ok: false; code: 'rpc_unreachable' | 'rpc_invalid_response'; message: string };

// One raw JSON-RPC eth_chainId POST against the candidate endpoint.
// Deliberately not viem: the id is unknown until this answers, and the
// probe must never touch shared client state. Every failure folds into a
// machine-readable code — 'rpc_unreachable' for transport/HTTP failures,
// 'rpc_invalid_response' for an endpoint that answered something that is
// not a positive-integer hex quantity.
async function probeRpcChainId(rpcUrl: string): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId' }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        ok: false,
        code: 'rpc_unreachable',
        message: `The RPC endpoint answered HTTP ${res.status} instead of a JSON-RPC result.`,
      };
    }

    let body: unknown;
    try {
      body = await res.json();
    }
    catch {
      return {
        ok: false,
        code: 'rpc_invalid_response',
        message: 'The RPC endpoint did not answer with JSON.',
      };
    }

    const result = (body as { result?: unknown } | null)?.result;
    if (typeof result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result)) {
      return {
        ok: false,
        code: 'rpc_invalid_response',
        message: `The eth_chainId answer was not a hex chain id (got ${JSON.stringify(result)}).`,
      };
    }

    // BigInt first: chain ids are uint64 in JSON-RPC even though every
    // real one fits a double; Number() of the BigInt keeps precision
    // honest and rejects anything beyond 2^53 as non-integer.
    const chainId = Number(BigInt(result));
    if (!Number.isInteger(chainId) || chainId <= 0) {
      return {
        ok: false,
        code: 'rpc_invalid_response',
        message: `The eth_chainId answer "${result}" is not a positive integer chain id.`,
      };
    }

    return { ok: true, chainId };
  }
  catch (error) {
    const reason = error instanceof Error ? error.message : 'network error';
    return {
      ok: false,
      code: 'rpc_unreachable',
      message: `Could not reach the RPC endpoint: ${reason}`,
    };
  }
  finally {
    clearTimeout(timer);
  }
}

// List registrations. Open read (the chain selector's "Add chain" flow
// and the unsupported-chain gate need it without an admin token), with
// the full URL only going to readers the CORS policy already trusts —
// same visibility rule as GET /rpc-configs.
app.get('/chains/custom', async (c) => {
  try {
    const rows = await db.select().from(customChains);

    const origin = c.req.header('origin');
    const seesFullUrl = origin ? isAllowedCorsOrigin(origin) : isLoopbackRemote(c);

    return c.json({
      chains: rows.map(row => ({
        chainId: row.chainId,
        name: row.name,
        symbol: row.symbol,
        decimals: row.decimals ?? 18,
        rpcUrl: seesFullUrl ? row.rpcUrl : redactUrl(row.rpcUrl),
        urlRedacted: !seesFullUrl,
      })),
    });
  }
  catch (error) {
    logger.error({ err: error }, 'Failed to list custom chains');
    return c.json({ error: 'Failed to list custom chains' }, 500);
  }
});

// Register a chain. Body { rpcUrl, name?, symbol?, decimals? } — the
// chain id always comes from the endpoint's own eth_chainId answer,
// never from the client. Opt-in admin gate (zero-config local works)
// plus a tight limiter: every accepted submission costs a live network
// probe.
const registerRateLimiter = createRateLimiter({
  name: 'custom-chain-register',
  requestsPerMinute: 5,
  burst: 2,
});

app.post('/chains/custom', requireAdminTokenIfConfigured, registerRateLimiter, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  }
  catch {
    return c.json(
      {
        error: 'Invalid JSON body',
        code: 'invalid_json',
        message: 'Request body must be valid JSON',
      },
      400,
    );
  }
  // Destructured from a parsed-JSON value: every field is unknown and
  // must earn its type through the guards below.
  const { rpcUrl, name, symbol, decimals } = (body ?? {}) as Record<string, unknown>;

  if (typeof rpcUrl !== 'string' || rpcUrl === '') {
    return c.json(
      {
        error: 'Invalid URL',
        code: 'invalid_url',
        message: 'rpcUrl is required and must be a string',
      },
      400,
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rpcUrl);
  }
  catch {
    return c.json(
      {
        error: 'Invalid URL',
        code: 'invalid_url',
        message: 'rpcUrl must be a valid absolute URL',
      },
      400,
    );
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return c.json(
      {
        error: 'Invalid URL',
        code: 'invalid_url',
        message: 'rpcUrl must use the http or https protocol',
      },
      400,
    );
  }

  if (
    (name !== undefined && (typeof name !== 'string' || name.trim() === ''))
    || (symbol !== undefined && (typeof symbol !== 'string' || symbol.trim() === ''))
    || (decimals !== undefined
      && (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 256))
  ) {
    return c.json(
      {
        error: 'Invalid optional fields',
        code: 'invalid_fields',
        message:
          'name and symbol must be non-empty strings and decimals an integer between 0 and 256 when present',
      },
      400,
    );
  }

  const probe = await probeRpcChainId(rpcUrl);
  if (!probe.ok) {
    return c.json({ error: probe.code, message: probe.message }, 502);
  }

  // viem already shipping the id as a REAL network means the user does
  // not need a custom registration at all — the ⚙ RPC override panel
  // points a known chain at a different endpoint. Say so instead of
  // shadowing viem's metadata. viem's local-dev placeholders (anvil and
  // its 31337 siblings) are exempt: they are templates with loopback
  // defaults, exactly what this flow exists to replace.
  if (isBuiltInChainProtected(probe.chainId)) {
    const known = getBuiltInChainInfo(probe.chainId);
    return c.json(
      {
        error: 'chain_already_known',
        message:
          `The RPC reports chain ID ${probe.chainId}, which this explorer already knows as "${known?.name ?? String(probe.chainId)}". `
          + 'Use the RPC override (⚙ RPC panel) for a known chain.',
        existingName: known?.name ?? String(probe.chainId),
        hint: 'Use the RPC override (⚙ RPC panel) for a known chain',
      },
      409,
    );
  }

  const effectiveName = name !== undefined ? name.trim() : `Chain ${probe.chainId}`;
  const effectiveSymbol = symbol !== undefined ? symbol.trim() : 'ETH';
  const effectiveDecimals = decimals ?? 18;

  try {
    await db
      .insert(customChains)
      .values({
        chainId: probe.chainId,
        name: effectiveName,
        symbol: effectiveSymbol,
        rpcUrl,
        decimals: effectiveDecimals,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: customChains.chainId,
        set: {
          name: effectiveName,
          symbol: effectiveSymbol,
          rpcUrl,
          decimals: effectiveDecimals,
          updatedAt: new Date(),
        },
      });

    registerCustomChain({
      chainId: probe.chainId,
      name: effectiveName,
      symbol: effectiveSymbol,
      decimals: effectiveDecimals,
      rpcUrl,
    });

    // Same hot-reload contract as POST /rpc-configs: the manager re-reads
    // both tables, so its per-chain client picks the new registration up
    // (and the registry stays mirrored on every path).
    await rpcManager.reloadConfigs();

    return c.json(
      {
        chainId: probe.chainId,
        name: effectiveName,
        symbol: effectiveSymbol,
        decimals: effectiveDecimals,
        rpcUrl,
      },
      201,
    );
  }
  catch (error) {
    logger.error(
      { err: error, chainId: probe.chainId },
      'Failed to register custom chain',
    );
    return c.json({ error: 'Failed to register custom chain' }, 500);
  }
});

// Remove a registration. Gated like the other writes; 404 when nothing
// is registered under the id, 204 on success. The RPC manager reload
// re-reads the table and drops both the client and the registry entry
// (removeCustomChain below is the belt to its braces: a failed reload
// must not leave a stale registration behind).
app.delete('/chains/custom/:chainId', requireAdminTokenIfConfigured, async (c) => {
  try {
    const param = c.req.param('chainId');
    const chainId = Number.parseInt(param, 10);
    if (Number.isNaN(chainId) || chainId <= 0) {
      return c.json(
        {
          error: 'Invalid chain ID',
          code: 'invalid_chain_id',
          message: 'chainId must be a positive integer',
        },
        400,
      );
    }

    const existing = await db
      .select({ chainId: customChains.chainId })
      .from(customChains)
      .where(eq(customChains.chainId, chainId));

    if (existing.length === 0) {
      return c.json(
        {
          error: 'not_found',
          message: `No custom chain is registered for chain ID ${chainId}`,
        },
        404,
      );
    }

    await db.delete(customChains).where(eq(customChains.chainId, chainId));

    removeCustomChain(chainId);
    await rpcManager.reloadConfigs();

    return c.body(null, 204);
  }
  catch (error) {
    logger.error({ err: error }, 'Failed to delete custom chain');
    return c.json({ error: 'Failed to delete custom chain' }, 500);
  }
});

export default app;
