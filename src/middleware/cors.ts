import { cors } from 'hono/cors';
import { isAllowedCorsOrigin } from './cors-origins';

// Allowlist-based CORS: requests without an Origin header (same-origin
// fetches, curl) pass through untouched; loopback and explicitly allowed
// origins get full CORS headers. Any other origin gets no
// Access-Control-Allow-Origin at all, so browsers block both the
// cross-origin read and preflighted writes. The origin policy itself lives
// in cors-origins.ts, shared with the Vite dev server config.
export const corsMiddleware = cors({
  origin: (origin) => {
    if (!origin) return null;
    return isAllowedCorsOrigin(origin) ? origin : null;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  // X-Admin-Token is required: the frontend injects it on gated writes and
  // talks to the API cross-origin (localhost:3000 -> localhost:8201), so
  // the preflight must allow it or those writes are blocked.
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Admin-Token'],
  exposeHeaders: ['X-Response-Time', 'X-Data-Source', 'X-Chain-Id'],
  maxAge: 86400,
});
