// Leaf tests for utils/fetchJson: the budget pair, the non-2xx reject
// and the JSON parse. The budget is the AbortController + setTimeout
// pair so fake timers can drive the abort — the exact reason the leaf
// avoids AbortSignal.timeout (jsdom builds that have it run it on a
// native timer fake timers cannot reach), and the no-timeout-static
// case pins that the leaf keeps budgeting in environments (older jsdom)
// where AbortSignal.timeout does not exist at all.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchJson } from '@/utils/fetchJson';

const fetchMock = vi.fn<typeof fetch>();

const respond = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fetchJson', () => {
  it('parses a 2xx body, passing url and merged init (with the budget signal) to fetch', async () => {
    fetchMock.mockResolvedValue(respond({ answer: 42 }));

    await expect(
      fetchJson('https://x.test/list', 8_000, { headers: { accept: 'application/json' } }),
    ).resolves.toEqual({ answer: 42 });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://x.test/list',
      expect.objectContaining({
        headers: { accept: 'application/json' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('rejects with the HTTP status on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(respond({}, 503));

    await expect(fetchJson('https://x.test/list', 8_000)).rejects.toThrow('HTTP 503');
  });

  it('lets a body-parse failure surface unchanged', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    } as unknown as Response);

    await expect(fetchJson('https://x.test/list', 8_000)).rejects.toThrow('bad json');
  });

  it('aborts a request that outlives the budget and clears its timer', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    // A fetch that only ever settles through its abort signal.
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('The operation was aborted'));
          });
        }),
    );

    const pending = fetchJson('https://x.test/slow', 8_000);
    vi.advanceTimersByTime(8_001);
    await expect(pending).rejects.toThrow('The operation was aborted');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the budget timer once the response lands', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    fetchMock.mockResolvedValue(respond({ ok: true }));

    await fetchJson('https://x.test/fast', 8_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still budgets when AbortSignal.timeout does not exist (older jsdom)', async () => {
    // A subclass drops the static while keeping everything else the
    // platform provides — the leaf must never depend on it.
    vi.stubGlobal('AbortSignal', class WithoutTimeout extends AbortSignal {});
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('The operation was aborted'));
          });
        }),
    );

    const pending = fetchJson('https://x.test/slow', 5_000);
    vi.advanceTimersByTime(5_001);
    await expect(pending).rejects.toThrow('The operation was aborted');
  });
});
