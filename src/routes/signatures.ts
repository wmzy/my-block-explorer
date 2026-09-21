// Signature lookup routes: batched openchain-backed resolution of unknown
// function selectors and event topic0 hashes, served from the DuckDB cache
// first. Read-only by design — no admin gate (the same data is public on
// openchain, and the browser page enhances raw hex with it).
import { Hono } from 'hono';
import { createLogger } from '../server/logger';
import { signatureService, type SelectorLookup } from '../services/SignatureService';

const logger = createLogger('signatures-routes');

const app = new Hono();

// One request may carry both kinds; the total (deduped) selector count is
// capped so a single call bounds both the DuckDB read and the upstream
// openchain round trip.
const MAX_SELECTORS = 25;

// Selector shapes: function selectors are 4 bytes (8 hex chars), event
// topic0 hashes 32 bytes (64 hex chars). Lowercase-only after
// normalization — the storage convention and the openchain API both use
// lowercase.
const FUNCTION_SELECTOR_RE = /^0x[0-9a-f]{8}$/;
const EVENT_TOPIC0_RE = /^0x[0-9a-f]{64}$/;

const shapeError = (kind: 'function' | 'event', raw: string) =>
  `Malformed ${kind} selector "${raw}" — expected a 0x-prefixed ${
    kind === 'function' ? '4-byte (8 hex character)' : '32-byte (64 hex character)'
  } value`;

// GET /signatures — repeatable `function` and `event` query params, each
// also accepting comma-batched values (openchain's own convention), mixed
// freely. Response: { results: { [selector]: outcome } } with per-selector
// outcomes {kind, signatures, source} | {kind, signatures: [], notFound} |
// {unavailable: true}.
app.get('/signatures', async c => {
  const paramGroups = [
    ['function', c.req.queries('function') ?? []],
    ['event', c.req.queries('event') ?? []],
  ] as const;

  const parsed: SelectorLookup[] = [];
  for (const [kind, values] of paramGroups) {
    for (const value of values) {
      for (const segment of value.split(',')) {
        const selector = segment.trim().toLowerCase();
        // Empty segments (trailing commas, a bare `function=`) are treated
        // as absent, matching the events routes' filter convention.
        if (selector === '') continue;
        const wellFormed =
          kind === 'function'
            ? FUNCTION_SELECTOR_RE.test(selector)
            : EVENT_TOPIC0_RE.test(selector);
        if (!wellFormed) {
          return c.json({ error: 'invalid_selector', message: shapeError(kind, segment) }, 400);
        }
        parsed.push({ kind, selector });
      }
    }
  }

  // Dedupe first: the cap guards upstream/database work, which duplicates
  // do not multiply.
  const unique = new Map<string, SelectorLookup>();
  for (const request of parsed) unique.set(`${request.kind}:${request.selector}`, request);
  if (unique.size > MAX_SELECTORS) {
    return c.json(
      {
        error: 'too_many_selectors',
        message: `Too many selectors requested (${unique.size}); the limit is ${MAX_SELECTORS} per call`,
      },
      400,
    );
  }
  if (unique.size === 0) return c.json({ results: {} });

  try {
    const outcomes = await signatureService.lookup([...unique.values()]);
    const results: Record<string, unknown> = {};
    for (const [selector, outcome] of outcomes) results[selector] = outcome;
    return c.json({ results });
  } catch (error) {
    logger.error({ err: error }, 'signature lookup failed');
    return c.json({ error: 'internal_error', message: 'Signature lookup failed' }, 500);
  }
});

export default app;
