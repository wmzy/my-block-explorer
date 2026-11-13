// Watch-subscription routes: the REST surface of services/WatchService.
// Reads are open (a local explorer's subscriptions are the operator's
// own); writes (PUT upsert, DELETE) are gated by
// requireAdminTokenIfConfigured and share one 5/min token bucket, so a
// runaway client cannot hammer the RPC-gated upsert path.
//
// Honesty rules: addresses validate through the same two tiers as every
// other route (getValidatedAddress) and store lowercase (C-3); an upsert
// on a chain without a usable RPC config is a 400 naming the missing
// config (never a silently dead subscription); the per-chain cap is a
// 400 'watch_full', not a silent drop; DELETE of an absent row is 404
// (idempotence would hide typos in the client's key). The events
// endpoint serves the in-memory ring buffer — process-local by design,
// empty after a backend restart (the honest "watching restarts now"
// world of the cursor baseline).
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createLogger } from '../server/logger';
import { getValidatedChainId, parseChainAndAddressRequest } from '../server/validation';
import { requireAdminTokenIfConfigured } from '../middleware/admin-token';
import { createRateLimiter } from '../middleware/rate-limit';
import { parsePaginationParams } from '../utils/validation';
import {
  watchService,
  WATCH_EVENTS_DEFAULT_LIMIT,
  WATCH_EVENTS_MAX_LIMIT,
} from '../services/WatchService';

const logger = createLogger('watch-routes');

const app = new Hono();

// Mirrors the address_labels.label budget; enforced again in the service
// so every entry point agrees on the cap.
const LABEL_MAX_LENGTH = 100;

// Webhook URL budget (the route's half of the contract; the sender side
// lives in utils/webhooks.ts).
const WEBHOOK_URL_MAX_LENGTH = 512;

// http(s) only — an ftp:/javascript: scheme would never be a webhook
// endpoint, and browsers refuse to POST cross-origin anyway.
const isValidHttpWebhookUrl = (candidate: string): boolean => {
  if (candidate.length > WEBHOOK_URL_MAX_LENGTH) return false;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

// 5 writes per minute per client (burst 5): the add/remove gestures of
// one operator, while a script cycling addresses cannot.
const watchWriteLimiter = createRateLimiter({
  name: 'watch-writes',
  requestsPerMinute: 5,
  burst: 5,
});

// :chainId/:address param validation is the shared labels/watch contract
// (parseChainAndAddressRequest): a bare {error: 'invalid_request',
// message} 400, storage keys lowercase (C-3).

// PUT body validation: { label?: string | null, webhookUrl?: string | null }.
// Label: absent body, absent label and null all mean "no label" (cleared
// on the conflict path); a label over the cap is a 400, not a silent
// truncation. Webhook URL: ABSENT means UNCHANGED (the PUT is an
// upsert-by-address, so a label-only re-put must not silently drop a
// configured webhook); null or an empty string means CLEAR; a non-empty
// value must be an http(s) URL of at most 512 chars — anything else is
// a 400 'invalid_webhook_url', never a silent store of a dead endpoint.
// Unknown extra keys are ignored (forward compatibility).
//
// Trust note (deliberate, documented): there is NO SSRF filtering on
// webhook URLs. This is a single-user, locally-run explorer — the
// operator points the webhook at their own Discord/HTTP endpoint, and
// the write is already behind the admin-token gate. Anyone who can PUT
// a webhook URL can also just run the process.
const parseWatchBody = (
  body: unknown,
):
  | { label: string | null; webhookUrl: string | null | undefined }
  | { error: string; message: string } => {
  if (body === undefined || body === null) return { label: null, webhookUrl: undefined };
  if (typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'invalid_label', message: 'Request body must be a JSON object' };
  }
  const { label, webhookUrl } = body as Record<string, unknown>;

  let parsedLabel: string | null;
  if (label === undefined || label === null) {
    parsedLabel = null;
  } else if (typeof label !== 'string') {
    return { error: 'invalid_label', message: 'label must be a string when present' };
  } else {
    const trimmed = label.trim();
    if (trimmed.length > LABEL_MAX_LENGTH) {
      return {
        error: 'invalid_label',
        message: `label must be at most ${LABEL_MAX_LENGTH} characters`,
      };
    }
    parsedLabel = trimmed === '' ? null : trimmed;
  }

  let parsedWebhookUrl: string | null | undefined;
  if (webhookUrl === undefined) {
    parsedWebhookUrl = undefined; // absent = unchanged
  } else if (webhookUrl === null) {
    parsedWebhookUrl = null; // explicit clear
  } else if (typeof webhookUrl !== 'string') {
    return {
      error: 'invalid_webhook_url',
      message: 'webhookUrl must be a string when present',
    };
  } else {
    const trimmed = webhookUrl.trim();
    if (trimmed === '') {
      parsedWebhookUrl = null; // empty string = clear
    } else if (!isValidHttpWebhookUrl(trimmed)) {
      return {
        error: 'invalid_webhook_url',
        message: `webhookUrl must be an http(s) URL of at most ${WEBHOOK_URL_MAX_LENGTH} characters`,
      };
    } else {
      parsedWebhookUrl = trimmed;
    }
  }

  return { label: parsedLabel, webhookUrl: parsedWebhookUrl };
};

// GET /chains/:chainId/watch — list this chain's subscriptions. Its
// error bodies are deliberately bare {error, message} — the documented
// watch-list contract (utils/api-error.ts names it) — unlike the events
// endpoint below, which rides the shared validator + canonical envelope.
app.get('/chains/:chainId/watch', async c => {
  let chainId: number;
  try {
    chainId = getValidatedChainId(c.req.param('chainId'));
  } catch (error) {
    return c.json(
      {
        error: 'invalid_request',
        message: error instanceof HTTPException ? error.message : 'Invalid chain ID',
      },
      400,
    );
  }
  try {
    const subscriptions = await watchService.listSubscriptions(chainId);
    c.header('Cache-Control', 'no-store');
    return c.json({ subscriptions });
  } catch (error) {
    logger.error({ err: error, chainId }, 'Watch list failed');
    return c.json({ error: 'internal_error', message: 'Failed to list watch subscriptions' }, 500);
  }
});

// PUT /chains/:chainId/watch/:address — upsert. A fresh row starts
// watching at the current head (never history); a re-put only replaces
// the label. 400 rpc_unavailable / watch_full come from the service with
// honest messages naming the fix.
app.put(
  '/chains/:chainId/watch/:address',
  requireAdminTokenIfConfigured,
  watchWriteLimiter,
  async c => {
    const parsed = parseChainAndAddressRequest(c.req.param('chainId'), c.req.param('address'));
    if ('error' in parsed) return c.json(parsed, 400);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined; // an empty body is a valid "no label" upsert
    }
    const parsedBody = parseWatchBody(body);
    if ('error' in parsedBody) return c.json(parsedBody, 400);

    try {
      const result = await watchService.upsertSubscription(
        parsed.chainId,
        parsed.address,
        parsedBody.label,
        parsedBody.webhookUrl,
      );
      if (!result.ok) {
        return c.json({ error: result.error, message: result.message }, 400);
      }
      c.header('Cache-Control', 'no-store');
      return c.json({ subscription: result.subscription });
    } catch (error) {
      logger.error(
        { err: error, chainId: parsed.chainId, address: parsed.address },
        'Watch upsert failed',
      );
      return c.json({ error: 'internal_error', message: 'Failed to save watch subscription' }, 500);
    }
  },
);

// DELETE /chains/:chainId/watch/:address — remove. 404 when absent.
app.delete(
  '/chains/:chainId/watch/:address',
  requireAdminTokenIfConfigured,
  watchWriteLimiter,
  async c => {
    const parsed = parseChainAndAddressRequest(c.req.param('chainId'), c.req.param('address'));
    if ('error' in parsed) return c.json(parsed, 400);

    try {
      const removed = await watchService.removeSubscription(parsed.chainId, parsed.address);
      if (!removed) {
        return c.json({ error: 'watch_not_found', message: 'No such watch subscription' }, 404);
      }
      return c.body(null, 204);
    } catch (error) {
      logger.error(
        { err: error, chainId: parsed.chainId, address: parsed.address },
        'Watch delete failed',
      );
      return c.json(
        { error: 'internal_error', message: 'Failed to delete watch subscription' },
        500,
      );
    }
  },
);

// GET /chains/:chainId/watch/events?limit= — newest ring-buffer events,
// newest-first. default 25, capped at 100 (clamped, not 400: an
// oversized ask is served honestly at the cap); a non-integer or
// non-positive limit is a 400. The chain-id param validates through the
// shared getValidatedChainId exactly like the sibling scan routes
// (transfers/approvals): a bad id throws HTTPException, which api-app's
// onError renders as the canonical error envelope — unlike the list
// endpoint above, this one never had a pinned invalid_request body. The
// limit slot rides the shared parsePaginationParams contract (strict
// decimal parse, below-one reject, over-cap clamp); its 400 keeps this
// endpoint's documented bare {error: 'invalid_limit', message} body.
app.get('/chains/:chainId/watch/events', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));

  const { limit } = parsePaginationParams(undefined, c.req.query('limit'), {
    defaultLimit: WATCH_EVENTS_DEFAULT_LIMIT,
    maxLimit: WATCH_EVENTS_MAX_LIMIT,
  });
  if (limit === null) {
    return c.json({ error: 'invalid_limit', message: 'limit must be a positive integer' }, 400);
  }

  c.header('Cache-Control', 'no-store');
  return c.json({ events: watchService.recentEvents(chainId, limit) });
});

// Lifecycle: mounting this sub-app owns the watcher interval (the
// EventIndexingService pattern — the service graph comes alive with the
// app import). Idempotent; WatchService.stop() exists for tests and
// shutdown.
watchService.start();

export default app;
