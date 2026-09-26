// Server-side share-card meta injection for the statically served SPA.
//
// The SPA's per-route <title>/og:title/og:description/twitter:card are
// maintained client-side by the DocumentTitle component — which never runs
// for crawlers and link unfurlers. When the built frontend is served from
// this server (SERVE_STATIC_DIR, wired in src/server.ts), HTML navigations
// to derive-able routes get the SAME derivations (src/utils/metaDescribe)
// injected into the served index.html, so a JS-less request sees honest
// per-entity meta instead of the generic placeholders.
//
// Idempotent by construction: tags are maintained by their attribute key
// (property/name) exactly like the client's setMetaContent — an index.html
// that already carries placeholder tags gets them replaced in place, never
// duplicated, and the hydrated client later updates those same tags in
// place too (pinned by tests/unit/ogMeta.test.tsx).
//
// Path policy (honesty first): only GET/HEAD navigations whose Accept
// header asks for text/html, and never /api/*. Non-matching paths and
// non-HTML Accept pass through untouched — the wiring in server.ts then
// hands them to the API app, whose behavior stays byte-identical to an
// API-only deployment.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  deriveDocumentTitle,
  deriveMetaDescription,
  isDerivableMetaPath,
} from '../utils/metaDescribe';

export type OgMetaOptions = {
  /** Path of the built SPA's index.html (absolute or cwd-relative). */
  indexHtmlPath: string;
};

// Reads index.html once (the in-flight promise is cached for the process
// lifetime); a failed read clears the cache so the next request retries
// instead of serving a stale rejection.
const createIndexHtmlCache = (indexHtmlPath: string) => {
  let cached: Promise<string> | null = null;
  const read = (): Promise<string> => {
    cached ??= readFile(indexHtmlPath, 'utf8').catch(error => {
      cached = null;
      throw error;
    });
    return cached;
  };
  // Kick the read off at wiring time ("read once at init") so the first
  // request usually hits a warm cache. A missing file is reported by the
  // server wiring's startup check, not here.
  void read().catch(() => undefined);
  return read;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Maintains the <title> element: replaces the first one in place (browsers
// and crawlers honor the first), inserts one after <head> when absent.
const upsertTitleElement = (html: string, title: string): string => {
  const escaped = escapeHtml(title);
  if (/<title\b[^>]*>[\s\S]*?<\/title\s*>/i.test(html)) {
    return html.replace(
      /<title\b[^>]*>[\s\S]*?<\/title\s*>/i,
      `<title>${escaped}</title>`,
    );
  }
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, match => `${match}\n    <title>${escaped}</title>`);
  }
  // No <head> at all: prepend, mirroring the meta-tag fallback below.
  return `<title>${escaped}</title>\n${html}`;
};

// Maintains one <meta> tag keyed by its name/property attribute: replaces
// the content attribute of the FIRST matching tag in place (whatever the
// attribute order), appends a content attribute when the placeholder tag
// carries none, or inserts a fresh tag before </head> when absent. Never
// duplicates a tag.
const upsertMetaTag = (
  html: string,
  attribute: 'name' | 'property',
  key: string,
  content: string,
): string => {
  const escaped = escapeHtml(content);
  const keyPattern = new RegExp(
    `${attribute}\\s*=\\s*["']${escapeRegExp(key)}["']`,
    'i',
  );
  let matched = false;
  const replaced = html.replace(/<meta\b[^>]*>/gi, tag => {
    if (matched || !keyPattern.test(tag)) return tag;
    matched = true;
    if (/\scontent\s*=\s*(?:"[^"]*"|'[^']*')/i.test(tag)) {
      return tag.replace(
        /\scontent\s*=\s*(?:"[^"]*"|'[^']*')/i,
        ` content="${escaped}"`,
      );
    }
    return tag.replace(/\s*\/?>\s*$/, ` content="${escaped}">`);
  });
  if (matched) return replaced;
  const fresh = `    <meta ${attribute}="${key}" content="${escaped}" />`;
  if (/<\/head\s*>/i.test(replaced)) {
    return replaced.replace(/<\/head\s*>/i, `${fresh}\n  </head>`);
  }
  if (/<head\b[^>]*>/i.test(replaced)) {
    return replaced.replace(/<head\b[^>]*>/i, match => `${match}\n${fresh}`);
  }
  // No <head> at all: prepend so the tags still precede any body content.
  return `${fresh}\n${replaced}`;
};

// The exact tag set the hydrated client's DocumentTitle maintains — same
// keys, same values — so hydration updates the server-injected tags in
// place instead of adding siblings.
export function injectShareMeta(html: string, title: string, description: string): string {
  let out = upsertTitleElement(html, title);
  out = upsertMetaTag(out, 'property', 'og:title', title);
  out = upsertMetaTag(out, 'property', 'og:description', description);
  out = upsertMetaTag(out, 'property', 'og:type', 'website');
  out = upsertMetaTag(out, 'name', 'twitter:card', 'summary');
  return out;
}

// A navigation request asks for a document; API/script/image requests do
// not. Only exact text/html media types count (with or without q params) —
// a bare */* (curl) deliberately does not opt in.
const isHtmlNavigation = (accept: string | undefined): boolean =>
  (accept
    ?.split(',')
    .some(part => part.split(';')[0]?.trim().toLowerCase() === 'text/html')) ??
    false;

// Guards shared by both middlewares: document navigations only, never the
// API subtree (exact /api included — an API base URL must never leak HTML).
const isEligibleNavigation = (
  method: string,
  pathname: string,
  accept: string | undefined,
): boolean =>
  (method === 'GET' || method === 'HEAD') &&
  !pathname.startsWith('/api/') &&
  pathname !== '/api' &&
  isHtmlNavigation(accept);

// Derivable HTML navigations get index.html with the shared derivations
// injected. Everything else — non-HTML Accept, other methods, /api/*, and
// shapes the derivations cannot name (they fall back to the static
// placeholders) — passes through untouched.
export function createOgMetaMiddleware(options: OgMetaOptions): MiddlewareHandler {
  const readIndexHtml = createIndexHtmlCache(options.indexHtmlPath);
  return async (c, next) => {
    const url = new URL(c.req.url);
    if (!isEligibleNavigation(c.req.method, url.pathname, c.req.header('accept'))) {
      return next();
    }
    const search = url.search;
    if (!isDerivableMetaPath(url.pathname, search)) return next();

    let html: string;
    try {
      html = await readIndexHtml();
    } catch (error) {
      // Fail open to the static path below (the SPA still loads; only the
      // injected meta is lost). The wiring's startup check makes this
      // unreachable in a correct deployment.
      console.error(`og-meta: cannot read ${options.indexHtmlPath}:`, error);
      return next();
    }

    const body = injectShareMeta(
      html,
      deriveDocumentTitle(url.pathname, search),
      deriveMetaDescription(url.pathname, search),
    );
    c.header('Content-Type', 'text/html; charset=utf-8');
    // The served document differs per route while the file is shared:
    // shared caches must revalidate, or one route's unfurl data poisons
    // every other route.
    c.header('Cache-Control', 'no-cache');
    if (c.req.method === 'HEAD') {
      return c.body(null, 200);
    }
    return c.body(body, 200);
  };
}

// SPA fallback for the remaining HTML navigations (non-derivable shapes
// like /, /sql or /ops): the plain index.html with its static
// placeholders, which the hydrated client then specializes. Non-HTML
// Accept and non-GET/HEAD pass through to the API app.
export function createSpaFallback(options: OgMetaOptions): MiddlewareHandler {
  const readIndexHtml = createIndexHtmlCache(options.indexHtmlPath);
  return async (c, next) => {
    const url = new URL(c.req.url);
    if (!isEligibleNavigation(c.req.method, url.pathname, c.req.header('accept'))) {
      return next();
    }
    let html: string;
    try {
      html = await readIndexHtml();
    } catch (error) {
      console.error(`og-meta: cannot read ${options.indexHtmlPath}:`, error);
      return next();
    }
    c.header('Content-Type', 'text/html; charset=utf-8');
    c.header('Cache-Control', 'no-cache');
    if (c.req.method === 'HEAD') {
      return c.body(null, 200);
    }
    return c.body(html, 200);
  };
}

// The full static-hosting stack behind SERVE_STATIC_DIR (wired in
// src/server.ts), composed so the layering is unit-testable without the
// database-bearing server module:
//   1. og-meta middleware — derivable HTML navigations get meta injected;
//   2. serveStatic — built assets (hashed /assets/*, public/ files, and
//      "/" via its directory index) as-is;
//   3. SPA fallback — remaining HTML navigations get the plain document;
//   4. delegation — everything left (non-HTML Accept, non-GET/HEAD — i.e.
//      API traffic) hit the frontend app's 404 and is re-dispatched to
//      `apiFetch` with the original request, env and execution context,
//      so API behavior (routing, error bodies, SSE streaming) stays
//      byte-identical to an API-only server.
//
// Assumes a root-mounted SPA (Vite base '/', like the nginx web target):
// a subpath deploy derives from subpath-prefixed paths and falls back to
// the static placeholders.
//
// The wiring in server.ts validates that <staticDir>/index.html exists
// before calling this; serve-static additionally warns when the root is
// missing.
export function createStaticFrontendHandler(options: {
  staticDir: string;
  apiFetch: Hono['fetch'];
}): Hono['fetch'] {
  const indexHtmlPath = join(options.staticDir, 'index.html');
  const frontend = new Hono();
  frontend.use('*', createOgMetaMiddleware({ indexHtmlPath }));
  frontend.use('*', serveStatic({ root: options.staticDir }));
  frontend.use('*', createSpaFallback({ indexHtmlPath }));
  return async (request, env, executionCtx) => {
    const response = await frontend.fetch(request, env, executionCtx);
    if (response.status === 404) {
      return options.apiFetch(request, env, executionCtx);
    }
    return response;
  };
}
