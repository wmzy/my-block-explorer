// Shared admin-surface error classification: the two admin views (Ops
// dashboard + SQL console) face the same two-tier ADMIN_TOKEN gate and
// the same limiter message format, so the parse lives once here and each
// view keeps only its own recovery copy. Browser-safe leaf beside
// adminAuth.ts — ApiError is the HTTP layer's browser-side error type.
import { ApiError } from '@/util/apiError';

// The admin gate's two distinct 403 faces: 'unauthorized' = the server
// has an ADMIN_TOKEN and this browser's stored token is missing or
// wrong; 'unconfigured' = the server answered from the STRICT tier's
// "no ADMIN_TOKEN" rejection (fail-closed by design). The recovery copy
// differs, so the distinction must survive to the UI.
export function adminGateFromError(error: unknown): 'unconfigured' | 'unauthorized' | null {
  if (!(error instanceof ApiError) || error.status !== 403) return null;
  return /Set ADMIN_TOKEN on the server/i.test(error.message) ? 'unconfigured' : 'unauthorized';
}

// The backend's 429 body message carries the wait ("…retry after 3s."),
// same fixed format as every limiter in this app; toApiError keeps the
// message but not the structured field, so the seconds are parsed back
// out of that fixed format.
export function rateLimitWaitSeconds(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.status !== 429) return null;
  const match = /retry after (\d+)s/i.exec(error.message);
  return match ? Number(match[1]) : null;
}
