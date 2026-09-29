// Unit tests for the MCP REST client: URL construction, envelope error
// mapping, and the backend-unreachable advice that tool callers see.

import { describe, expect, it, vi } from 'vitest';
import { ExplorerApi, McpApiError, McpBackendUnreachableError } from '@/mcp/rest';

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('ExplorerApi', () => {
  it('normalizes trailing slashes off the base', async () => {
    const fetchImpl = vi.fn(async (_url: string) => okJson({ ok: true }));
    const api = new ExplorerApi('http://127.0.0.1:8201///', fetchImpl);
    await api.get('/api/health');
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8201/api/health');
  });

  it('encodes query params and skips empty values', async () => {
    const fetchImpl = vi.fn(async (_url: string) => okJson([]));
    const api = new ExplorerApi('http://x', fetchImpl);
    await api.get('/api/search', { q: 'weth', chainId: 137, eventName: undefined, page: '' });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://x/api/search?q=weth&chainId=137');
  });

  it('maps the {error, message} envelope onto McpApiError with status context', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'invalid_page', message: 'page must be a number' }), { status: 400 }),
    );
    const api = new ExplorerApi('http://x', fetchImpl);
    const error = await api.get('/api/x').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(McpApiError);
    const apiError = error as McpApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.code).toBe('invalid_page');
    expect(apiError.message).toContain('HTTP 400');
    expect(apiError.message).toContain('invalid_page');
    expect(apiError.message).toContain('page must be a number');
  });

  it('prefers the explicit code field over the error slug', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: 'not_found', code: 'not_a_contract', message: 'no code' }), { status: 404 }),
    );
    const api = new ExplorerApi('http://x', fetchImpl);
    const error = (await api.get('/api/x').catch((caught: unknown) => caught)) as McpApiError;
    expect(error.code).toBe('not_a_contract');
  });

  it('survives non-JSON error bodies', async () => {
    const fetchImpl = vi.fn(async () => new Response('gateway exploded', { status: 502 }));
    const api = new ExplorerApi('http://x', fetchImpl);
    const error = (await api.get('/api/x').catch((caught: unknown) => caught)) as McpApiError;
    expect(error.status).toBe(502);
    expect(error.message).toContain('gateway exploded');
  });

  it('wraps network failures as backend-unreachable with start advice', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const api = new ExplorerApi('http://127.0.0.1:8201', fetchImpl);
    const error = await api.get('/api/health').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(McpBackendUnreachableError);
    expect((error as Error).message).toContain('http://127.0.0.1:8201');
    expect((error as Error).message).toContain('npx my-block-explorer');
  });

  it('wraps request timeouts as backend-unreachable too', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('The operation was aborted due to timeout');
    });
    const api = new ExplorerApi('http://x', fetchImpl);
    const error = await api.get('/api/x').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(McpBackendUnreachableError);
    expect((error as Error).message).toContain('timeout');
  });

  it('tryGet degrades to null only on unreachable, not on HTTP errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const unreachable = new ExplorerApi('http://x', fetchImpl);
    await expect(unreachable.tryGet('/api/x')).resolves.toBeNull();

    const fetch500 = vi.fn(async () => new Response(JSON.stringify({ error: 'internal_error' }), { status: 500 }));
    const failing = new ExplorerApi('http://x', fetch500);
    await expect(failing.tryGet('/api/x')).rejects.toBeInstanceOf(McpApiError);
  });
});
