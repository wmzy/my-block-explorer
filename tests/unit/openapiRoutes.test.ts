// Contract tests for the hand-maintained OpenAPI document served at
// GET /api/openapi.json:
// (a) a structurally valid OpenAPI 3.1-ish shape (openapi field, info,
//     non-empty paths, every path starts with '/'),
// (b) every documented operation carries a summary and a unique
//     operationId,
// (c) spot-checks pinning documented params against the REAL route
//     handlers — the route sources are read from src/routes/ and must
//     actually consume each param name the spec documents (the guard
//     against this spec drifting from the code it describes),
// (d) the sub-app answers GET /api/openapi.json with the exported
//     document (status, content type, cache header, body equality).
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import openapiRoutes, { openApiDocument } from '@/routes/openapi';

const app = new Hono();
app.route('/api', openapiRoutes);

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

const operations = () => {
  const found: Array<{
    path: string;
    method: HttpMethod;
    op: NonNullable<(typeof openApiDocument.paths)[string][HttpMethod]>;
  }> = [];
  for (const [path, item] of Object.entries(openApiDocument.paths)) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (op) found.push({ path, method, op });
    }
  }
  return found;
};

// ---------------------------------------------------------------------------
// (a) Document shape
// ---------------------------------------------------------------------------

describe('openapi document shape', () => {
  it('declares OpenAPI 3.1 with info and a non-empty path table', () => {
    expect(openApiDocument.openapi).toMatch(/^3\.1\.\d+$/);
    expect(openApiDocument.info.title).toBe('My Block Explorer API');
    expect(openApiDocument.info.description).toContain('Hand-maintained');
    expect(openApiDocument.info.description).toContain('docs/API.md');
    expect(openApiDocument.info.description).toContain('source of truth');
    expect(Object.keys(openApiDocument.paths).length).toBeGreaterThan(40);
  });

  it('reads the version from package.json via src/version.ts (no duplicate source)', async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(openApiDocument.info.version).toBe(pkg.version);
  });

  it('uses the relative /api server form so it resolves on any host/port', () => {
    expect(openApiDocument.servers).toEqual([
      expect.objectContaining({ url: '/api' }),
    ]);
  });

  it('every path starts with "/" and uses OpenAPI braces, not Hono colons', () => {
    for (const path of Object.keys(openApiDocument.paths)) {
      expect(path.startsWith('/'), `path ${path}`).toBe(true);
      expect(path.includes(':'), `path ${path} must use {param} style`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// (b) Operation hygiene
// ---------------------------------------------------------------------------

describe('openapi operations', () => {
  it('every documented operation carries a non-empty summary', () => {
    const ops = operations();
    expect(ops.length).toBeGreaterThanOrEqual(55);
    for (const { path, method, op } of ops) {
      expect(typeof op.summary, `${method} ${path}`).toBe('string');
      expect((op.summary as string).length, `${method} ${path}`).toBeGreaterThan(0);
    }
  });

  it('operationIds are unique (client generators require it)', () => {
    const ids = operations().map(({ op }) => op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// (c) Param spot-checks against the real route handlers
// ---------------------------------------------------------------------------

type SpotRow = {
  file: string;
  path: string;
  method: HttpMethod;
  param: string;
  /** Every needle must appear in the route source (all-match semantics). */
  needles: string[];
};

// Each row pins one documented param to the handler code that consumes it.
// Needles are exact source fragments of src/routes/<file>.
const SPOT_ROWS: SpotRow[] = [
  // The method selector filter on address transactions (400 invalid_method).
  {
    file: 'addresses.ts',
    path: '/chains/{chainId}/addresses/{address}/transactions',
    method: 'get',
    param: 'method',
    needles: ["query('method')", 'METHOD_SELECTOR_RE'],
  },
  {
    file: 'addresses.ts',
    path: '/chains/{chainId}/addresses/{address}/transactions',
    method: 'get',
    param: 'balanceHistory',
    needles: ["query('balanceHistory')"],
  },
  {
    file: 'addresses.ts',
    path: '/chains/{chainId}/addresses/{address}/transactions',
    method: 'get',
    param: 'fromAddress',
    needles: ["query('fromAddress')"],
  },
  {
    file: 'addresses.ts',
    path: '/chains/{chainId}/addresses/{address}/transactions',
    method: 'get',
    param: 'minValue',
    needles: ["query('minValue')"],
  },
  {
    file: 'addresses.ts',
    path: '/chains/{chainId}/addresses/{address}/transactions',
    method: 'get',
    param: 'window',
    needles: ["query('window')"],
  },
  {
    file: 'addresses.ts',
    path: '/chains/{chainId}/addresses/{address}/transactions',
    method: 'get',
    param: 'page',
    needles: ["query('page')"],
  },
  {
    file: 'addresses.ts',
    path: '/chains/{chainId}/addresses/{address}/transactions/export',
    method: 'get',
    param: 'offset',
    needles: ["query('offset')"],
  },
  {
    file: 'blocks.ts',
    path: '/chains/{chainId}/blocks',
    method: 'get',
    param: 'limit',
    needles: ["query('limit')"],
  },
  {
    file: 'blocks.ts',
    path: '/chains/{chainId}/blocks',
    method: 'get',
    param: 'offset',
    needles: ["query('offset')"],
  },
  {
    file: 'blocks.ts',
    path: '/chains/{chainId}/blocks/{blockNumber}',
    method: 'get',
    param: 'blockNumber',
    needles: ["param('blockNumber')"],
  },
  {
    file: 'transactions.ts',
    path: '/chains/{chainId}/transactions',
    method: 'get',
    param: 'limit',
    needles: ["query('limit')"],
  },
  {
    file: 'transactions.ts',
    path: '/chains/{chainId}/transactions/{hash}',
    method: 'get',
    param: 'hash',
    needles: ["param('hash')"],
  },
  {
    file: 'transfers.ts',
    path: '/chains/{chainId}/addresses/{address}/transfers',
    method: 'get',
    param: 'cursor',
    needles: ["query('cursor')"],
  },
  {
    file: 'transfers.ts',
    path: '/chains/{chainId}/addresses/{address}/transfers',
    method: 'get',
    param: 'mode',
    needles: ["query('mode')", 'SCAN_MODES'],
  },
  {
    file: 'transfers.ts',
    path: '/chains/{chainId}/addresses/{address}/transfers',
    method: 'get',
    param: 'refresh',
    needles: ["query('refresh')"],
  },
  {
    file: 'approvals.ts',
    path: '/chains/{chainId}/addresses/{address}/approvals',
    method: 'get',
    param: 'window',
    needles: ["query('window')"],
  },
  {
    file: 'events.ts',
    path: '/chains/{chainId}/contracts/{address}/events',
    method: 'get',
    param: 'pageSize',
    needles: ["query('pageSize')"],
  },
  {
    file: 'events.ts',
    path: '/chains/{chainId}/contracts/{address}/events',
    method: 'get',
    param: 'eventName',
    needles: ["get('eventName')"],
  },
  {
    file: 'events.ts',
    path: '/chains/{chainId}/contracts/{address}/events',
    method: 'get',
    param: 'argFilters',
    needles: ["get('argFilters')"],
  },
  {
    file: 'events.ts',
    path: '/chains/{chainId}/contracts/{address}/events',
    method: 'get',
    param: 'topic0',
    needles: ["'topic0'"],
  },
  {
    file: 'events.ts',
    path: '/chains/{chainId}/contracts/{address}/events/ranges/{rangeId}',
    method: 'patch',
    param: 'rangeId',
    needles: ["param('rangeId')"],
  },
  {
    file: 'search.ts',
    path: '/search',
    method: 'get',
    param: 'q',
    needles: ["query('q')"],
  },
  {
    file: 'search.ts',
    path: '/search',
    method: 'get',
    param: 'chainId',
    needles: ["query('chainId')"],
  },
  {
    file: 'watch.ts',
    path: '/chains/{chainId}/watch/events',
    method: 'get',
    param: 'limit',
    needles: ["query('limit')"],
  },
  {
    file: 'signatures.ts',
    path: '/signatures',
    method: 'get',
    param: 'function',
    needles: ["queries('function')"],
  },
  {
    file: 'signatures.ts',
    path: '/signatures',
    method: 'get',
    param: 'event',
    needles: ["queries('event')"],
  },
];

describe('openapi params match the real route handlers', () => {
  it('documents every spot-checked param on the matching operation', () => {
    for (const row of SPOT_ROWS) {
      const op = operations().find(o => o.path === row.path && o.method === row.method);
      expect(op, `${row.method} ${row.path} is documented`).toBeDefined();
      const names = (op?.op.parameters ?? []).map(p => p.name);
      expect(names, `${row.method} ${row.path} documents ${row.param}`).toContain(row.param);
    }
  });

  it('every spot-checked param is actually consumed by its route handler', async () => {
    const sources = new Map<string, string>();
    const readRoute = async (file: string): Promise<string> => {
      const cached = sources.get(file);
      if (cached !== undefined) return cached;
      const text = await readFile(join(process.cwd(), 'src/routes', file), 'utf8');
      sources.set(file, text);
      return text;
    };
    for (const row of SPOT_ROWS) {
      const source = await readRoute(row.file);
      for (const needle of row.needles) {
        expect(
          source.includes(needle),
          `src/routes/${row.file} should contain ${needle} (param ${row.param})`,
        ).toBe(true);
      }
    }
  });

  it('documents the method selector shape the handler enforces', () => {
    const op = operations().find(
      o => o.path === '/chains/{chainId}/addresses/{address}/transactions' && o.method === 'get',
    );
    const methodParam = (op?.op.parameters ?? []).find(p => p.name === 'method');
    // Mirror of the handler's METHOD_SELECTOR_RE (0x + 8 hex, case-insensitive).
    expect(methodParam?.schema.pattern).toBe('^0x[0-9a-fA-F]{8}$');
  });
});

// ---------------------------------------------------------------------------
// (d) The sub-app serves the document
// ---------------------------------------------------------------------------

describe('GET /api/openapi.json', () => {
  it('answers 200 with the serialized document and the agreed headers', async () => {
    const res = await app.request('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(await res.json()).toEqual(openApiDocument);
  });

  it('serves a JSON-round-trippable body (stable serialization, no per-request work)', async () => {
    const res = await app.request('/api/openapi.json');
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(openApiDocument)));
  });
});
