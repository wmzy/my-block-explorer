// Server-side og/twitter meta injection (2026-09-25 gap wave). JS-less
// requests (crawlers, link unfurlers) never run the client DocumentTitle
// component, so a statically served SPA used to unfurl with the generic
// placeholders on every route. These tests pin the server-side half — the
// pure tag injection (adds, replaces placeholders in place, never
// duplicates), the middleware routing policy (HTML navigations only,
// never /api/*, derivable families only, everything else untouched) — and
// the client half's coexistence: hydration updates server-injected tags
// in place instead of duplicating them. The derivation strings themselves
// are pinned by tests/unit/documentTitle.test.tsx against the SAME shared
// module (src/utils/metaDescribe.ts) that both halves consume.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import {
  MemoryRouter,
  View,
  createRoutes,
  useRouter,
} from '@native-router/react';
import { navigate } from '@native-router/core';

import {
  createOgMetaMiddleware,
  createSpaFallback,
  createStaticFrontendHandler,
  injectShareMeta,
} from '@/middleware/og-meta';
import { deriveDocumentTitle, deriveMetaDescription } from '@/utils/metaDescribe';
import { DocumentTitle } from '@/views';

const TX_HASH = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd';
const ADDRESS = '0x9876543210abcdef9876543210abcdef9876543210';

// Mirrors the built index.html shape: charset + viewport + placeholder
// title, no og tags (the hydrated client adds those itself).
const MINIMAL_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Block Explorer</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

// A hand-authored index.html that already carries placeholder share tags
// (attribute order deliberately varies — content before property on one —
// to pin replace-in-place for both orders).
const PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>My Block Explorer</title>
    <meta property="og:title" content="PLACEHOLDER TITLE" />
    <meta property="og:description" content="PLACEHOLDER DESCRIPTION" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta content="PLACEHOLDER TYPE" property="og:type" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

// A browser navigation Accept header (document requests ask for text/html;
// the trailing */* alone must NOT opt a request in).
const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5';

let tempDir = '';

const buildApp = async (html: string) => {
  tempDir = await mkdtemp(join(tmpdir(), 'ogmeta-'));
  const indexHtmlPath = join(tempDir, 'index.html');
  await writeFile(indexHtmlPath, html);
  const app = new Hono();
  app.use('*', createOgMetaMiddleware({ indexHtmlPath }));
  // Same registration order as src/server.ts: assets before the fallback.
  app.use('*', serveStatic({ root: tempDir }));
  app.use('*', createSpaFallback({ indexHtmlPath }));
  // Sentinel downstream handler: proves pass-through leaves the request
  // untouched for the next handler in line.
  app.all('*', c => c.text('fell-through', 404));
  return app;
};

afterEach(async () => {
  cleanup();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

const countOccurrences = (html: string, needle: string): number =>
  html.split(needle).length - 1;

// Reads the content attribute off the first <meta> tag carrying the given
// name/property key, whatever the attribute order inside the tag.
const metaContent = (
  html: string,
  attribute: 'name' | 'property',
  key: string,
): string | null => {
  const tag = html.match(
    new RegExp(`<meta\\b[^>]*\\s${attribute}=["']${key}["'][^>]*>`, 'i'),
  );
  if (!tag) return null;
  const content = tag[0].match(/\scontent\s*=\s*"([^"]*)"/i);
  return content?.[1] ?? null;
};

describe('injectShareMeta (pure)', () => {
  it('adds the full share-tag set and replaces the placeholder title', () => {
    const out = injectShareMeta(
      MINIMAL_HTML,
      `Tx ${TX_HASH.slice(0, 10)}… · Ethereum`,
      `View transaction ${TX_HASH.slice(0, 10)}… on Ethereum — block, gas, status and decoded calls.`,
    );

    expect(out).toContain(`<title>Tx ${TX_HASH.slice(0, 10)}… · Ethereum</title>`);
    expect(out).not.toContain('My Block Explorer</title>');
    expect(countOccurrences(out, '<title>')).toBe(1);

    expect(metaContent(out, 'property', 'og:title')).toBe(
      `Tx ${TX_HASH.slice(0, 10)}… · Ethereum`,
    );
    expect(metaContent(out, 'property', 'og:description')).toBe(
      `View transaction ${TX_HASH.slice(0, 10)}… on Ethereum — block, gas, status and decoded calls.`,
    );
    expect(metaContent(out, 'property', 'og:type')).toBe('website');
    expect(metaContent(out, 'name', 'twitter:card')).toBe('summary');

    // Exactly one of each — the injection never duplicates.
    expect(countOccurrences(out, 'property="og:title"')).toBe(1);
    expect(countOccurrences(out, 'property="og:description"')).toBe(1);
    expect(countOccurrences(out, 'property="og:type"')).toBe(1);
    expect(countOccurrences(out, 'name="twitter:card"')).toBe(1);
  });

  it('replaces existing placeholder tags in place instead of duplicating them', () => {
    const out = injectShareMeta(PLACEHOLDER_HTML, 'Polygon Explorer', 'Explore Polygon: latest blocks, transactions, gas and chain stats.');

    expect(out).not.toContain('PLACEHOLDER');
    expect(metaContent(out, 'property', 'og:title')).toBe('Polygon Explorer');
    expect(metaContent(out, 'property', 'og:description')).toBe(
      'Explore Polygon: latest blocks, transactions, gas and chain stats.',
    );
    // The content-before-property attribute order is maintained, not rewritten.
    expect(out).toContain('<meta content="website" property="og:type" />');
    // twitter:card content is corrected in place (placeholder said large).
    expect(metaContent(out, 'name', 'twitter:card')).toBe('summary');
    expect(countOccurrences(out, 'property="og:title"')).toBe(1);
    expect(countOccurrences(out, '<title>')).toBe(1);
  });

  it('escapes HTML-special characters in both element text and attributes', () => {
    const out = injectShareMeta(MINIMAL_HTML, 'Block <1> & "q"', 'Desc <b>&</b> "x"');
    expect(out).toContain('<title>Block &lt;1&gt; &amp; &quot;q&quot;</title>');
    expect(metaContent(out, 'property', 'og:title')).toBe('Block &lt;1&gt; &amp; &quot;q&quot;');
    expect(metaContent(out, 'property', 'og:description')).toBe(
      'Desc &lt;b&gt;&amp;&lt;/b&gt; &quot;x&quot;',
    );
  });

  it('is idempotent: applying it twice yields the same document', () => {
    const once = injectShareMeta(MINIMAL_HTML, 'Base Blocks', 'Browse the latest blocks on Base.');
    const twice = injectShareMeta(once, 'Base Blocks', 'Browse the latest blocks on Base.');
    expect(twice).toBe(once);
  });
});

describe('og-meta middleware', () => {
  it('serves an entity route with meta derived by the shared functions', async () => {
    const app = await buildApp(MINIMAL_HTML);
    const path = `/chain/1/tx/${TX_HASH}`;
    const res = await app.request(path, { headers: { accept: HTML_ACCEPT } });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    // The document differs per route while the file is shared: no shared caching.
    expect(res.headers.get('cache-control')).toBe('no-cache');

    const body = await res.text();
    // The exact strings the client-side DocumentTitle would compute.
    expect(body).toContain(`<title>${deriveDocumentTitle(path, '')}</title>`);
    expect(metaContent(body, 'property', 'og:title')).toBe(deriveDocumentTitle(path, ''));
    expect(metaContent(body, 'property', 'og:description')).toBe(
      deriveMetaDescription(path, ''),
    );
    expect(metaContent(body, 'name', 'twitter:card')).toBe('summary');
  });

  it('covers list routes and query-carrying search navigations', async () => {
    const app = await buildApp(MINIMAL_HTML);

    const list = await app.request('/chain/137', { headers: { accept: HTML_ACCEPT } });
    expect(metaContent(await list.text(), 'property', 'og:title')).toBe('Polygon Explorer');

    const search = await app.request('/search?chain=137', { headers: { accept: HTML_ACCEPT } });
    const searchBody = await search.text();
    expect(metaContent(searchBody, 'property', 'og:title')).toBe('Search · Polygon');
    expect(metaContent(searchBody, 'property', 'og:description')).toBe(
      'Search blocks, transactions, addresses and contracts on Polygon.',
    );
  });

  it('replaces placeholder tags the static file already carries', async () => {
    const app = await buildApp(PLACEHOLDER_HTML);
    const res = await app.request(`/chain/8453/address/${ADDRESS}`, {
      headers: { accept: HTML_ACCEPT },
    });
    const body = await res.text();
    expect(body).not.toContain('PLACEHOLDER');
    expect(countOccurrences(body, 'property="og:title"')).toBe(1);
    expect(metaContent(body, 'property', 'og:title')).toBe(
      `Address ${ADDRESS.slice(0, 10)}… · Base`,
    );
  });

  it('answers HEAD navigations with the same headers and an empty body', async () => {
    const app = await buildApp(MINIMAL_HTML);
    const res = await app.request(`/chain/1/tx/${TX_HASH}`, {
      method: 'HEAD',
      headers: { accept: HTML_ACCEPT },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('never touches the API subtree, non-HTML Accept, other methods, or non-derivable shapes', async () => {
    const app = await buildApp(MINIMAL_HTML);

    // /api is never matched, whatever the Accept.
    const apiPath = await app.request('/api/search?q=0xdead', { headers: { accept: HTML_ACCEPT } });
    expect(await apiPath.text()).toBe('fell-through');
    const apiRoot = await app.request('/api', { headers: { accept: HTML_ACCEPT } });
    expect(await apiRoot.text()).toBe('fell-through');

    // Non-HTML Accept on a derivable route passes through (API clients,
    // curl) — including the bare */* wildcard.
    const jsonAccept = await app.request(`/chain/1/tx/${TX_HASH}`, {
      headers: { accept: 'application/json' },
    });
    expect(await jsonAccept.text()).toBe('fell-through');
    const wildcard = await app.request(`/chain/1/tx/${TX_HASH}`, {
      headers: { accept: '*/*' },
    });
    expect(await wildcard.text()).toBe('fell-through');

    // Non-navigation methods never get HTML.
    const post = await app.request(`/chain/1/tx/${TX_HASH}`, {
      method: 'POST',
      headers: { accept: HTML_ACCEPT },
    });
    expect(await post.text()).toBe('fell-through');

    // Shapes the derivations cannot name keep the static placeholders:
    // the og middleware passes them through, the SPA fallback serves the
    // plain document (byte-identical to the file, no og tags added).
    const unknown = await app.request('/chain/1/unknown-section', {
      headers: { accept: HTML_ACCEPT },
    });
    expect(unknown.status).toBe(200);
    expect(await unknown.text()).toBe(MINIMAL_HTML);
    const local = await app.request('/sql', { headers: { accept: HTML_ACCEPT } });
    expect(local.status).toBe(200);
    expect(await local.text()).toBe(MINIMAL_HTML);
  });

  it('serves built assets as files, untouched by the meta injection', async () => {
    const app = await buildApp(MINIMAL_HTML);
    await mkdir(join(tempDir, 'assets'));
    await writeFile(join(tempDir, 'assets', 'app.js'), 'console.warn("asset")');

    const res = await app.request('/assets/app.js', { headers: { accept: '*/*' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('console.warn("asset")');
    expect(res.headers.get('content-type')).toContain('javascript');
  });
});

describe('spa fallback', () => {
  it('serves the plain document for non-derivable HTML navigations', async () => {
    const app = await buildApp(MINIMAL_HTML);
    const res = await app.request('/', { headers: { accept: HTML_ACCEPT } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    // Byte-identical to the file on disk: no og tags, placeholder title.
    expect(await res.text()).toBe(MINIMAL_HTML);
  });

  it('passes through non-HTML Accept instead of serving the document', async () => {
    const app = await buildApp(MINIMAL_HTML);
    // /sql is no file on disk and not derivable: with a non-HTML Accept the
    // fallback declines and the request falls through to the API app.
    // (Paths that DO map to real files — like / — are served by the static
    // file layer Accept-agnostically, like any static server.)
    const res = await app.request('/sql', { headers: { accept: 'application/json' } });
    expect(await res.text()).toBe('fell-through');
  });
});

describe('static frontend handler (composed, as wired in server.ts)', () => {
  // The exact stack SERVE_STATIC_DIR mounts, exercised against a stand-in
  // API app: everything the static layers decline must reach the API
  // byte-identically (its routes, its 404 body), while HTML navigations
  // get the SPA document.
  const buildComposed = async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ogmeta-'));
    await writeFile(join(tempDir, 'index.html'), MINIMAL_HTML);
    await mkdir(join(tempDir, 'assets'));
    await writeFile(join(tempDir, 'assets', 'app.js'), 'console.warn("asset")');

    const api = new Hono();
    api.get('/api/health', c => c.json({ status: 'ok' }));
    api.post('/api/echo', c => c.text('api-echo', 201));
    api.notFound(c => c.json({ error: 'api-404' }, 404));

    const handler = createStaticFrontendHandler({
      staticDir: tempDir,
      apiFetch: api.fetch,
    });
    return (path: string, init?: RequestInit) =>
      handler(new Request(`http://localhost${path}`, init));
  };

  it('delegates API traffic untouched, including the API 404 body', async () => {
    const request = await buildComposed();

    const health = await request('/api/health', { headers: { accept: HTML_ACCEPT } });
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });

    const echo = await request('/api/echo', { method: 'POST', body: 'x' });
    expect(echo.status).toBe(201);
    expect(await echo.text()).toBe('api-echo');

    // The API app's own notFound body, not the frontend's default 404.
    const unknownApi = await request('/api/nope', { headers: { accept: 'application/json' } });
    expect(unknownApi.status).toBe(404);
    expect(await unknownApi.json()).toEqual({ error: 'api-404' });
  });

  it('serves the SPA with meta for derivable routes and plain otherwise', async () => {
    const request = await buildComposed();
    const path = `/chain/1/tx/${TX_HASH}`;

    const injected = await request(path, { headers: { accept: HTML_ACCEPT } });
    expect(await injected.text()).toContain(
      `<title>${deriveDocumentTitle(path, '')}</title>`,
    );

    const plain = await request('/', { headers: { accept: HTML_ACCEPT } });
    expect(await plain.text()).toBe(MINIMAL_HTML);

    // Assets still come from the file layer.
    const asset = await request('/assets/app.js', { headers: { accept: '*/*' } });
    expect(await asset.text()).toBe('console.warn("asset")');

    // Non-HTML Accept on a non-file path delegates to the API (its 404).
    const delegated = await request('/sql', { headers: { accept: 'application/json' } });
    expect(delegated.status).toBe(404);
    expect(await delegated.json()).toEqual({ error: 'api-404' });
  });
});

// ---------------------------------------------------------------------------
// Client-side coexistence: the server injects og:title/og:description/
// og:type/twitter:card into the served HTML; the hydrated DocumentTitle
// must adopt those exact tags (same attribute keys) instead of appending
// siblings — no duplicate tags after hydration.
// ---------------------------------------------------------------------------

// Seeds the jsdom head with tags in the exact shape the server emits
// (via the real injector, so format drift fails here too).
const seedServerInjectedTags = (title: string, description: string): void => {
  const seeded = injectShareMeta('<head></head>', title, description);
  document.head.insertAdjacentHTML('afterbegin', seeded.replace(/<\/?head>/g, ''));
};

// A view stub that navigates the harness router on demand (click exercises
// the history-listener path, like the DocumentTitle tests).
const makeNavigateStub = (to: string) =>
  function NavigateStub() {
    const router = useRouter();
    return (
      <button type="button" onClick={() => void navigate(router, to).catch(() => undefined)}>
        go
      </button>
    );
  };

function renderTitleHarness(initial: string, navTarget: string) {
  const stub = makeNavigateStub(navTarget);
  const routes = createRoutes([
    { path: '/chain/:chainId', component: () => stub },
    { path: '/chain/:chainId/tx/:txHash', component: () => stub },
  ]);
  return render(
    <MemoryRouter routes={routes} initialEntries={[initial]}>
      <DocumentTitle />
      <View />
    </MemoryRouter>,
  );
}

describe('DocumentTitle × server-injected tags', () => {
  beforeEach(() => {
    document.title = '';
    document.head
      .querySelectorAll('meta[property^="og:"], meta[name="twitter:card"], title')
      .forEach(tag => tag.remove());
  });

  it('adopts the server-injected tags in place — no duplicates after hydration', () => {
    const serverTitle = deriveDocumentTitle(`/chain/1/tx/${TX_HASH}`, '');
    const serverDescription = deriveMetaDescription(`/chain/1/tx/${TX_HASH}`, '');
    seedServerInjectedTags(serverTitle, serverDescription);

    renderTitleHarness(`/chain/1/tx/${TX_HASH}`, '/chain/137');

    // Same shared derivation → identical strings, stable content.
    expect(document.title).toBe(serverTitle);
    expect(document.head.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
    expect(document.head.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content).toBe(serverTitle);
    expect(document.head.querySelectorAll('meta[property="og:description"]')).toHaveLength(1);
    expect(document.head.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content).toBe(
      serverDescription,
    );
    expect(document.head.querySelectorAll('meta[property="og:type"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[name="twitter:card"]')).toHaveLength(1);
  });

  it('keeps exactly one tag set across an in-app navigation from a server-injected state', async () => {
    seedServerInjectedTags(
      deriveDocumentTitle(`/chain/1/tx/${TX_HASH}`, ''),
      deriveMetaDescription(`/chain/1/tx/${TX_HASH}`, ''),
    );

    renderTitleHarness(`/chain/1/tx/${TX_HASH}`, '/chain/137');
    fireEvent.click(await screen.findByRole('button', { name: 'go' }));

    await waitFor(() => expect(document.title).toBe('Polygon Explorer'));
    expect(document.head.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
    expect(document.head.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content).toBe(
      'Polygon Explorer',
    );
    expect(document.head.querySelectorAll('meta[property="og:description"]')).toHaveLength(1);
    expect(document.head.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content).toBe(
      'Explore Polygon: latest blocks, transactions, gas and chain stats.',
    );
    expect(document.head.querySelectorAll('meta[name="twitter:card"]')).toHaveLength(1);
  });
});
