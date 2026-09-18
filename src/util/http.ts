import * as ff from 'fetch-fun';

import { getAdminToken } from '@/util/adminAuth';
import { getApiBase } from '@/util/apiBase';
import { ApiError } from '@/util/apiError';

// Backend error bodies are {message, code?, details?} with some routes
// using {error} instead (e.g. quick-range 400s). Anything else (e.g. an
// HTML error page) degrades to undefined by fetch-fun's JSON reader, so
// extract fields defensively instead of trusting the shape.
function toApiError(e: ff.HTTPError): ApiError {
  const body: Record<string, unknown> =
    typeof e.data === 'object' && e.data !== null
      ? (e.data as Record<string, unknown>)
      : {};
  const message = typeof body.message === 'string' ? body.message : undefined;
  const errorText = typeof body.error === 'string' ? body.error : undefined;
  const code = typeof body.code === 'string' ? body.code : undefined;
  const details = 'details' in body ? body.details : undefined;
  return new ApiError(message ?? errorText ?? `HTTP ${e.status}`, e.status, code, details);
}

// Base chain: JSON headers, a per-attempt 10s timeout budget, and error
// mapping to ApiError. No retry in this app: the backend is GET-dominant
// and the only writes are contract reads and rpc-config management, none
// of which should replay. The x-admin-token header (when a token is set
// via util/adminAuth) is injected per request in based() below.
const base = ff
  .create()
  .pipe(ff.header, 'content-type', 'application/json')
  .pipe(ff.header, 'accept', 'application/json')
  .pipe(ff.timeout, 10_000)
  .pipe(ff.mapError, (e: unknown) => {
    if (e instanceof ff.HTTPError) return toApiError(e);
    if (e instanceof ff.TimeoutError) {
      return new ApiError('Request timeout', 408);
    }
    if (e instanceof ff.NetworkError) {
      return new ApiError(e.message, 0);
    }
    // User aborts and foreign errors pass through unchanged: an aborted
    // query is a cancellation, not a failure to surface as an error state.
    return e;
  });

// Request functions only accept chains derived from `api`: the phantom
// brand cannot be constructed outside this module, so the header/timeout/
// mapError invariants are guaranteed at the type level, not by convention.
// The brand flows through `pipe` and the exported combinators.
declare const apiBrand: unique symbol;

/** Options accepted as the trailing argument of the request helpers. */
export type ApiClient = ff.Options & ff.Pipe & { readonly [apiBrand]: never };

export const api: ApiClient = base as unknown as ApiClient;

// Chain for deliberately slow endpoints (the address tx-history scan runs
// under the server's own 30s budget; the default 10s per-attempt timeout
// would abort healthy scans). Derived from `api` so the brand (and its
// header/timeout/mapError invariants) carry through.
export const longRunningApi: ApiClient = api.pipe(ff.timeout, 35_000);

// The API base is discovered at runtime, so it cannot be baked into the
// chain: resolve it per request. '' keeps the URL relative (same-origin).
// The admin token is likewise runtime state and rides along whenever set,
// so gated endpoints (rpc-config, cache invalidation) work once the user
// has entered a token — no per-call opt-in.
function based(o: ApiClient): ff.Options {
  let chain = ff.baseUrl(o, getApiBase());
  const token = getAdminToken();
  if (token) chain = ff.header(chain, 'x-admin-token', token);
  return chain;
}

// ff.signal requires a non-null signal: this wrapper accepts undefined
// (query-layer signals are per-request transient) and spreads it through,
// which is runtime-equivalent.
export function withSignal<T extends ff.Options>(o: T, signal?: AbortSignal): T {
  return { ...o, signal };
}

// Degraded-mode guard: when service discovery found no backend, the API
// base is '' and a "relative" request would go same-origin — in dev that
// silently hits the vite honoApiPlugin bridge (a second backend instance
// fighting over the DuckDB single-writer lock), in prod it 404s or returns
// SPA HTML. Both are slow and misleading; reject fast with a clear message
// instead. Per-surface error states already render ApiError messages.
// Rejected-promise form (not a sync throw) so `.catch()` chained directly
// on a helper's return value still observes it.
function backendUnconnected<T>(): Promise<T> {
  return Promise.reject(
    new ApiError('Backend not connected — indexed data unavailable', 0),
  );
}

export function get<T = unknown>(
  url: string,
  params?: Record<string, string | number | undefined>,
  o: ApiClient = api,
): Promise<T> {
  if (getApiBase() === '') return backendUnconnected<T>();
  let chain = ff.url(ff.method(based(o), 'get'), url);
  if (params) {
    // Drop undefined entries so optional filters stay out of the URL.
    const defined = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined),
    ) as Record<string, string | number | boolean>;
    chain = ff.query(chain, defined);
  }
  return ff.fetchJSON<T>(chain) as Promise<T>;
}

export function del<T = unknown>(url: string, o: ApiClient = api): Promise<T> {
  if (getApiBase() === '') return backendUnconnected<T>();
  return ff.fetchJSON<T>(ff.url(ff.method(based(o), 'delete'), url)) as Promise<T>;
}

export function post<T = unknown>(url: string, data: unknown, o: ApiClient = api): Promise<T> {
  return sendJSON<T>('post', url, data, o);
}

export function put<T = unknown>(url: string, data: unknown, o: ApiClient = api): Promise<T> {
  return sendJSON<T>('put', url, data, o);
}

function sendJSON<T>(m: string, url: string, data: unknown, o: ApiClient): Promise<T> {
  if (getApiBase() === '') return backendUnconnected<T>();
  return ff.fetchJSON<T>(
    ff.body(ff.method(ff.url(based(o), url), m), JSON.stringify(data)),
  ) as Promise<T>;
}
