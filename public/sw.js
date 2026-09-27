/*
 * Service worker for the explorer's PWA shell.
 *
 * Served verbatim from public/ (never bundled) and registered only in
 * production builds by src/util/pwa.ts — the dev server is never controlled,
 * so HMR and dev assets are untouched.
 *
 * Honesty model (matches the app's data-separation architecture):
 * - ONLY the app shell is cached. The explorer's substance is live data —
 *   RPC reads, the backend API, SSE streams — and none of it is ever
 *   cached or served stale:
 *     - same-origin /api (and /api/*) requests bypass this worker entirely;
 *     - cross-origin requests (RPC providers, DefiLlama, openchain) bypass;
 *     - non-GET requests bypass.
 *   Offline, the cached shell boots and the app's own honest failure states
 *   (BackendOfflineState, RPC error cards) tell the truth about the network.
 *
 * Strategies:
 * - Navigations: network-first. A successful HTML response is cached under a
 *   SINGLE shell key (the scope root), so any route can be restored offline —
 *   the SPA fallback serves the same document for every path anyway. When the
 *   network fails, the cached shell is served; if the very first visit never
 *   completed, a small inline offline page explains the state.
 * - ${base}assets/* (content-hashed, immutable build output): cache-first.
 * - Other same-origin GET static files (favicon, manifest, icons):
 *   stale-while-revalidate.
 *
 * Scope-relative paths derive from self.registration.scope, so the same file
 * serves root deploys ('/') and subpath deploys ('/my-block-explorer/') —
 * matching the VITE_BASE / router baseUrl convention.
 */
/* Service worker scope globals, absent from the shared config's globals
   list (no-undef satisfaction). */
/* global self, caches, fetch */
'use strict';

// Bump to invalidate every cache (old versions are deleted on activate).
const VERSION = 'v1';
const SHELL_CACHE = `be-shell-${VERSION}`;
const STATIC_CACHE = `be-static-${VERSION}`;

// Deploy prefix: '/' for root, '/my-block-explorer/' style for subpath hosts.
const BASE = new URL('./', self.registration.scope).pathname;
// The single cache key for the app shell document (scope root URL).
const SHELL_KEY = new URL('./', self.registration.scope).href;

// Same-origin API subtree (backend REST + SSE) — never seen here, by design.
const isApiPath = (pathname) => pathname === `${BASE}api` || pathname.startsWith(`${BASE}api/`);
// Content-hashed build output — immutable, safe to serve without revalidation.
const isAssetPath = (pathname) => pathname.startsWith(`${BASE}assets/`);

// A navigation that neither the network nor the cache can answer. Inline on
// purpose: the fallback must survive having nothing cached at all (first
// visit gone offline mid-load).
const offlineDocument = () =>
  new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>My Block Explorer — offline</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         font-family: system-ui, sans-serif; background: #101319; color: #e6e9ef; }
  main { max-width: 32rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 .75rem; }
  p { color: #9aa3b2; line-height: 1.5; margin: 0 0 1.5rem; }
  button { font: inherit; padding: .5rem 1.25rem; border-radius: .5rem; border: 0;
           background: #0075ff; color: #fff; cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>You are offline</h1>
  <p>The explorer shell is not cached yet, and no page can be loaded without
     a network connection. Reconnect and retry — blockchain data is always
     read live, never served stale.</p>
  <button onclick="location.reload()">Retry</button>
</main>
</body>
</html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

// Navigations: network-first; on success refresh the shell copy, on failure
// serve the cached shell (offline boot of the SPA).
async function handleNavigation(request) {
  try {
    const fresh = await fetch(request);
    if (fresh?.ok) {
      const cache = await caches.open(SHELL_CACHE);
      // Any route's HTML is the same SPA document — one key serves them all.
      await cache.put(SHELL_KEY, fresh.clone());
    }
    return fresh;
  } catch {
    const cached = await caches.match(SHELL_KEY);
    return cached ?? offlineDocument();
  }
}

// Cache-first for immutable, content-hashed assets.
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh?.ok) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, fresh.clone());
  }
  return fresh;
}

// Stale-while-revalidate for same-origin static files that may change
// between builds (favicon, manifest, icons). The revalidation fetch is
// registered with event.waitUntil by the caller so the worker stays alive
// to complete the cache update.
async function staleWhileRevalidate(request, revalidating) {
  const cached = await caches.match(request);
  if (cached) {
    await revalidating;
    return cached;
  }
  const fresh = await revalidating;
  // Nothing cached and the network failed: an honest 503 beats a
  // respondWith(undefined) rejection.
  return fresh ?? new Response('offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // RPC providers & friends
  if (isApiPath(url.pathname)) return; // live data — never intercepted

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
  } else if (isAssetPath(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else {
    const revalidating = fetch(request)
      .then((response) => {
        if (response?.ok) {
          return caches
            .open(STATIC_CACHE)
            .then((cache) => cache.put(request, response.clone()))
            .then(() => response);
        }
        return response;
      })
      .catch(() => undefined);
    event.waitUntil(revalidating);
    event.respondWith(staleWhileRevalidate(request, revalidating));
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== SHELL_CACHE && name !== STATIC_CACHE).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

// Update flow: the page asks a waiting worker to take over immediately
// (see offerReload in src/util/pwa.ts — the user clicks Reload first).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
