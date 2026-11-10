// URL-secret visibility for RPC endpoint registrations, shared by
// routes/rpc-config.ts and routes/chains.ts (GET /rpc-configs ·
// GET /chains/custom). Custom endpoint URLs routinely embed provider API
// keys in the path or query (the RPC config modal invites exactly that),
// so a "URL" field is a secret on the wire: the full value only goes to
// readers the CORS policy already trusts, everyone else gets scheme +
// host. The pure socket-address loopback predicate lives in
// cors-origins.ts (which must stay dependency-free — vite.config.ts
// bundles it via a relative esbuild import); this module is the
// hono-aware half and owns everything that needs a request Context.
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { isAllowedCorsOrigin, isLoopbackRemoteAddress } from './cors-origins';

// Redact to scheme + host; a URL that does not parse degrades to an
// opaque marker rather than leaking.
export function redactUrl(url: string): string {
  try {
    const { protocol, host } = new URL(url);
    return `${protocol}//${host}/…`;
  } catch {
    return '…';
  }
}

// Origin-less requests cannot lean on CORS — browsers always send Origin
// on cross-origin reads, so "no Origin" mostly means scripts (curl,
// anything HTTP-capable), not a trusted same-origin reader. The one
// unforgeable signal left is the socket: only loopback callers
// (127.0.0.0/8, ::1, including the ::ffff:-mapped IPv4 form Node reports
// on dual-stack listeners — the shared cors-origins predicate) keep
// seeing full URLs. Runtimes without socket info (the in-process Vite
// dev bridge) and any parse surprise fail closed.
function isLoopbackRemote(c: Context): boolean {
  try {
    return isLoopbackRemoteAddress(getConnInfo(c).remote.address);
  } catch {
    return false;
  }
}

// The full-URL gate both list routes apply per row: allowlisted Origins
// (loopback + operator-configured extras, decided by the shared
// cors-origins policy) or Origin-less requests coming from a loopback
// socket (local curl, same-host scripts). Everything else — foreign
// Origins, and remote Origin-less clients for which CORS never applied —
// must be served the redactUrl() form.
export function requestSeesFullUrl(c: Context): boolean {
  const origin = c.req.header('origin');
  return origin ? isAllowedCorsOrigin(origin) : isLoopbackRemote(c);
}
