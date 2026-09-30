import { createHash, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { respondError } from '../utils/api-error';

const DISABLED_MESSAGE =
  'Admin operations are disabled. Set ADMIN_TOKEN on the server to enable them.';

// Gates mutating/admin endpoints behind the ADMIN_TOKEN shared secret,
// checked via the x-admin-token header. Fails closed: with no token
// configured on the server, every request is rejected.
export const requireAdminToken: MiddlewareHandler = async (c, next) => {
  const adminToken = process.env.ADMIN_TOKEN;

  if (!adminToken) {
    return respondError(c, 403, 'Forbidden', DISABLED_MESSAGE);
  }

  // Both sides are sha256-hashed before the comparison: the digests are
  // fixed 32-byte buffers, so timingSafeEqual never sees a length
  // difference and no length branch remains (a length pre-check would
  // time-leak the ADMIN_TOKEN's byte length). A missing header still
  // degrades to ''.
  const expected = createHash('sha256').update(adminToken, 'utf8').digest();
  const provided = createHash('sha256')
    .update(c.req.header('x-admin-token') ?? '', 'utf8')
    .digest();

  const authorized = timingSafeEqual(provided, expected);

  if (!authorized) {
    return respondError(c, 403, 'Forbidden', 'Invalid admin token.');
  }

  await next();
};

// Opt-in admin gate for core-workflow writes that must keep working in a
// zero-config local session: with no ADMIN_TOKEN configured the request
// passes straight through; with one configured, enforcement is identical
// to requireAdminToken (delegated above, so the 403 bodies match exactly).
export const requireAdminTokenIfConfigured: MiddlewareHandler = (c, next) => {
  if (!process.env.ADMIN_TOKEN) {
    return next();
  }
  // The returned promise must propagate: it carries the 403 Response on
  // rejection paths, and dropping it leaves the context unfinalized.
  return requireAdminToken(c, next);
};
