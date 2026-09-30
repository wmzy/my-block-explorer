// Route-coverage guard for the hand-maintained OpenAPI document
// (src/routes/openapi.ts): every route mounted by src/api-app.ts must have
// a spec entry, and every spec entry must correspond to a real route
// declaration. The spec is hand-maintained, so it CAN drift — this test
// makes drift a failure instead of a silent gap for consumers.
//
// How the mounted surface is derived (code is the source of truth):
// - src/api-app.ts source is parsed for (a) `import <name> from
//   './routes/<file>'` (local-name → file mapping) and (b) the
//   `app.route('<prefix>', <name>)` sub-app mounts plus the direct
//   `app.<method>('<path>')` registrations on the root app itself.
// - each mounted route module's source is parsed for
//   `app.<method>('<path>'` registrations; the mount prefix is prepended.
// - `:param` path segments are normalized to OpenAPI `{param}` style.
// - spec path keys resolve against the document's servers array (the /api
//   prefix, plus the host-root entry used by the conditionally-mounted
//   debug path — see the ENABLE_DEBUG_API annotation check below).
//
// The extraction regexes are deliberately tolerant (either quote style,
// arbitrary whitespace/newlines between the parenthesis and the path
// literal) so prettier reformatting or multi-line registrations cannot
// break them. app.use(...) middleware is intentionally not collected.
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openApiDocument } from '@/routes/openapi';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

type MountedRoute = { method: HttpMethod; path: string };

// app.get('/path', …) — a method call whose first argument is a path
// string literal starting with '/'. Single/double/backtick quotes and
// multiline call layouts both match.
const ROUTE_RE = /\bapp\.(get|post|put|patch|delete)\(\s*(['"`])(\/[^'"`\n]*)\2/g;

// app.route('/api', someRoutes) — sub-app mount.
const MOUNT_RE = /\bapp\.route\(\s*(['"`])(\/[^'"`\n]*)\1\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;

// import someRoutes from './routes/some' — local name → module file.
const IMPORT_RE = /import\s+([A-Za-z_$][\w$]*)\s+from\s+'\.\/routes\/([\w-]+)'/g;

/** `:param` path segments → OpenAPI `{param}` style. */
const normalizePath = (path: string): string => path.replace(/:([A-Za-z_$][\w$]*)/g, '{$1}');

const extractRegistrations = (source: string): MountedRoute[] => {
  const routes: MountedRoute[] = [];
  for (const match of source.matchAll(ROUTE_RE)) {
    routes.push({ method: match[1] as HttpMethod, path: match[3] });
  }
  return routes;
};

/** Every route a fresh boot of the api-app could serve (debug included). */
const collectMountedRoutes = async (): Promise<MountedRoute[]> => {
  const apiAppSource = await readFile(join(process.cwd(), 'src/api-app.ts'), 'utf8');

  const moduleFiles = new Map<string, string>();
  for (const match of apiAppSource.matchAll(IMPORT_RE)) {
    moduleFiles.set(match[1], `src/routes/${match[2]}.ts`);
  }

  // Direct registrations on the root app (GET /api, GET /api/health).
  const mounted: MountedRoute[] = [...extractRegistrations(apiAppSource)];

  for (const match of apiAppSource.matchAll(MOUNT_RE)) {
    const prefix = match[2];
    const moduleName = match[3];
    const file = moduleFiles.get(moduleName);
    if (file === undefined) {
      throw new Error(
        `app.route('${prefix}', ${moduleName}) has no matching ./routes import in api-app.ts`,
      );
    }
    const source = await readFile(join(process.cwd(), file), 'utf8');
    for (const route of extractRegistrations(source)) {
      mounted.push({ method: route.method, path: `${prefix}${route.path}` });
    }
  }

  return mounted.map(({ method, path }) => ({ method, path: normalizePath(path) }));
};

const specOperations = (): Array<{ path: string; method: HttpMethod; description: string }> => {
  const found: Array<{ path: string; method: HttpMethod; description: string }> = [];
  for (const [path, item] of Object.entries(openApiDocument.paths)) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (op) found.push({ path, method, description: op.description });
    }
  }
  return found;
};

/** The mounted forms a spec path key resolves to (one per server URL). */
const specCandidates = (key: string): string[] =>
  openApiDocument.servers.map(server =>
    // RFC 3986 join: an absolute path key replaces the server's path. The
    // host-root server ('/') therefore passes the key through, while the
    // /api server prefixes it. A trailing slash is meaningless for Hono
    // route matching, so comparisons strip it ('/api/' === '/api').
    `${server.url.replace(/\/+$/, '')}${key}`,
  );

/** Trailing-slash-insensitive comparison form. */
const comparable = (path: string): string => path.replace(/\/+$/, '');

const loadCoverage = async () => {
  const mounted = await collectMountedRoutes();
  const spec = specOperations();

  const isDocumented = (route: MountedRoute): boolean =>
    spec.some(
      op =>
        op.method === route.method &&
        specCandidates(op.path).some(c => comparable(c) === comparable(route.path)),
    );
  const isMounted = (op: { path: string; method: HttpMethod }): boolean =>
    mounted.some(
      route =>
        route.method === op.method &&
        specCandidates(op.path).some(c => comparable(c) === comparable(route.path)),
    );

  return {
    mounted,
    spec,
    missingInSpec: mounted.filter(route => !isDocumented(route)),
    staleInSpec: spec.filter(op => !isMounted(op)),
  };
};

describe('openapi route coverage', () => {
  it('extracts a plausible mounted surface (guards against regex rot)', async () => {
    const { mounted } = await loadCoverage();
    // If the extraction regexes silently break, both diff sets below go
    // empty and the suite would pass vacuously — this floor (plus the
    // spot memberships) makes that impossible.
    expect(mounted.length).toBeGreaterThanOrEqual(70);
    const keys = new Set(mounted.map(r => `${r.method} ${r.path}`));
    expect(keys.has('get /api/health')).toBe(true);
    expect(keys.has('get /api/openapi.json')).toBe(true);
    expect(keys.has('post /api/sql/query')).toBe(true);
    // A known multi-line registration (storage.ts formats it across lines).
    expect(keys.has('delete /api/chains/{chainId}/contracts/{address}/storage-layout/cache')).toBe(
      true,
    );
    // The conditionally-mounted debug surface counts as mounted too.
    expect(keys.has('post /debug/db/query')).toBe(true);
  });

  it('every mounted route has a spec entry', async () => {
    const { missingInSpec } = await loadCoverage();
    expect(
      missingInSpec.map(r => `${r.method.toUpperCase()} ${r.path}`),
      'mounted routes missing from src/routes/openapi.ts (add them or the spec lies by omission)',
    ).toEqual([]);
  });

  it('every spec entry corresponds to a real route declaration', async () => {
    const { staleInSpec } = await loadCoverage();
    expect(
      staleInSpec.map(op => `${op.method.toUpperCase()} ${op.path}`),
      'spec entries with no matching route in src/api-app.ts + src/routes/* (stale — remove them)',
    ).toEqual([]);
  });

  it('conditionally-mounted /debug paths carry the ENABLE_DEBUG_API annotation', async () => {
    const { spec } = await loadCoverage();
    const debugOps = spec.filter(op => specCandidates(op.path).some(p => p.startsWith('/debug')));
    expect(debugOps.length).toBeGreaterThanOrEqual(1);
    for (const op of debugOps) {
      expect(op.description, `${op.method} ${op.path}`).toContain('ENABLE_DEBUG_API=1');
    }
  });
});
