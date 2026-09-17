// Pure CORS origin allowlist, shared by two independent servers: the Hono
// CORS middleware (src/middleware/cors.ts) and the Vite dev server config
// (vite.config.ts imports this module RELATIVELY). Keep this file
// dependency-free: vite.config.ts is bundled by esbuild without @/ alias
// resolution, so any import graph beyond zero breaks the dev server.
//
// Policy: requests with no Origin (same-origin fetches, curl) need no CORS
// at all; loopback origins (any port) are always allowed — this is a
// self-hosted single-user explorer and a local dev frontend (vite on
// localhost:3000) reaches the API cross-origin on localhost:8201; extra
// origins come from CORS_ALLOWED_ORIGINS (comma-separated) plus FRONTEND_URL.

const loopbackOriginPattern = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

function normalizeOrigin(origin: string): string {
  // Origin headers never carry a trailing slash; tolerate config sloppiness.
  return origin.trim().toLowerCase().replace(/\/+$/, '');
}

// Env-derived extras are re-read per call so config changes apply without a
// server restart (the Hono middleware consults this per request).
function extraAllowedOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const raw of [process.env.CORS_ALLOWED_ORIGINS, process.env.FRONTEND_URL]) {
    for (const part of (raw ?? '').split(',')) {
      const origin = normalizeOrigin(part);
      if (origin) origins.add(origin);
    }
  }
  return origins;
}

// The allowlist as a static list — the shape `cors`-style servers accept
// directly (RegExp + literal origins). Used by the Vite dev server config,
// which snapshots it once at startup.
export function allowedCorsOriginList(): (string | RegExp)[] {
  return [loopbackOriginPattern, ...extraAllowedOrigins()];
}

// Per-request decision used by the Hono CORS middleware.
export function isAllowedCorsOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  return loopbackOriginPattern.test(normalized) || extraAllowedOrigins().has(normalized);
}
