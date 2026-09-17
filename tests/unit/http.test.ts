import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as ff from 'fetch-fun';

import { getApiBase, onApiBaseChange, setApiBase } from '@/util/apiBase';
import { ApiError } from '@/util/apiError';
import { api, del, get, post, put, withSignal } from '@/util/http';

// fetch-fun's JSON reader reads the body via res.text(); HTTPError reads
// status/statusText/url and fetchData checks res.type. The stand-in only
// implements the members actually consumed, narrowed to Response when
// attached to the fetch mock.
function mockResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Internal Server Error',
    url: '/api/test',
    type: 'basic' as const,
    headers: new Headers(),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

// Fetch stand-in that pends until the signal aborts, mimicking native
// fetch: an already-aborted signal rejects immediately, otherwise it
// listens for the abort event; without a signal it never settles.
// signal.reason is a DOMException at runtime (an Error subclass), narrowed
// here to satisfy prefer-promise-reject-errors.
function hangingFetch() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      if (signal.aborted) return reject(signal.reason as Error);
      signal.addEventListener(
        'abort',
        () => reject(init.signal!.reason as Error),
        { once: true },
      );
    }),
  );
}

// Header assertions read from the captured RequestInit.
function sentHeaders(mock: ReturnType<typeof vi.fn>): Headers {
  const init = mock.mock.calls[0][1] as RequestInit;
  return new Headers(init.headers);
}

describe('http utilities', () => {
  // vi.fn() without a generic infers an implementation returning
  // undefined; instantiate explicitly with the fetch signature.
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    // apiBase is module-level state: reset to same-origin between cases.
    setApiBase('');
  });

  describe('get', () => {
    it('makes a GET request with JSON headers and parses the body', async () => {
      const health = { status: 'healthy' };
      fetchMock.mockResolvedValue(mockResponse(health));

      const result = await get('/api/health');

      expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.anything());
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/health',
        expect.objectContaining({ method: 'get' }),
      );
      expect(sentHeaders(fetchMock).get('content-type')).toBe('application/json');
      expect(sentHeaders(fetchMock).get('accept')).toBe('application/json');
      expect(result).toEqual(health);
    });

    it('serializes params and drops undefined entries', async () => {
      fetchMock.mockResolvedValue(mockResponse({ blocks: [], total: 0 }));

      await get('/api/chains/1/blocks', {
        limit: 10,
        offset: 5,
        cursor: undefined,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/chains/1/blocks?limit=10&offset=5',
        expect.objectContaining({ method: 'get' }),
      );
    });

    it('forces the GET method: the helper has the last word on the derived chain', async () => {
      fetchMock.mockResolvedValue(mockResponse({}));

      // The client argument may carry any options, but the exported
      // helper overrides the method afterwards — the request stays a GET.
      await get('/api/health', undefined, api.pipe(ff.method, 'post'));

      expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('get');
    });

    it('forwards the abort signal via the derived chain', async () => {
      fetchMock.mockResolvedValue(mockResponse({}));
      const controller = new AbortController();

      await get('/api/health', undefined, withSignal(api, controller.signal));

      // Timeout and abort compose into one signal: aborting the
      // controller aborts the signal fetch received.
      const init = fetchMock.mock.calls[0][1]!;
      expect(init.signal).toBeInstanceOf(AbortSignal);
      controller.abort();
      expect(init.signal!.aborted).toBe(true);
    });
  });

  describe('post / put / del', () => {
    it('sends a JSON body with the POST method', async () => {
      fetchMock.mockResolvedValue(mockResponse({ result: '42' }));
      const data = { functionName: 'balanceOf', args: ['0xabc'] };

      await post('/api/chains/1/contracts/0xabc/read', data);

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/chains/1/contracts/0xabc/read',
        expect.objectContaining({ method: 'post', body: JSON.stringify(data) }),
      );
    });

    it('sends a JSON body with the PUT method', async () => {
      fetchMock.mockResolvedValue(mockResponse({}));
      const data = { url: 'https://rpc.example' };

      await put('/api/rpc-configs', data);

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/rpc-configs',
        expect.objectContaining({ method: 'put', body: JSON.stringify(data) }),
      );
    });

    it('sends a DELETE without a body', async () => {
      fetchMock.mockResolvedValue(mockResponse({ deleted: true }));

      await del('/api/rpc-configs/1');

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.method).toBe('delete');
      expect(init.body).toBeUndefined();
    });
  });

  describe('api base', () => {
    it('keeps URLs relative while the base is empty (same-origin)', async () => {
      fetchMock.mockResolvedValue(mockResponse({}));

      await get('/api/health');

      expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.anything());
    });

    it('prefixes requests with the current base', async () => {
      setApiBase('http://x:1');
      fetchMock.mockResolvedValue(mockResponse({}));

      await get('/api/health');

      expect(fetchMock).toHaveBeenCalledWith('http://x:1/api/health', expect.anything());
    });

    it('collapses a trailing slash on the base', async () => {
      setApiBase('http://x:1/');
      fetchMock.mockResolvedValue(mockResponse({}));

      await get('/api/health');

      expect(fetchMock).toHaveBeenCalledWith('http://x:1/api/health', expect.anything());
    });

    it('resolves the base per request, not at module load', async () => {
      fetchMock.mockResolvedValue(mockResponse({}));

      await get('/api/health');
      setApiBase('http://x:1');
      await get('/api/health');

      expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/health', expect.anything());
      expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://x:1/api/health', expect.anything());
    });
  });

  describe('apiBase store', () => {
    it('fires change listeners and supports unsubscribe', () => {
      const seen: string[] = [];
      const off = onApiBaseChange(() => seen.push(getApiBase()));

      setApiBase('http://a:1');
      expect(seen).toEqual(['http://a:1']);

      off();
      setApiBase('http://b:2');
      expect(seen).toEqual(['http://a:1']);
    });

    it('is idempotent: re-setting the current value fires nothing', () => {
      const fn = vi.fn();
      const off = onApiBaseChange(fn);

      setApiBase('http://a:1');
      setApiBase('http://a:1');

      expect(fn).toHaveBeenCalledTimes(1);
      off();
    });
  });

  describe('error mapping', () => {
    it('maps a non-OK body to ApiError with message, status, code and details', async () => {
      fetchMock.mockResolvedValue(
        mockResponse(
          {
            message: 'contract not found',
            code: 'NOT_FOUND',
            details: { chainId: 1, address: '0xabc' },
          },
          false,
          404,
        ),
      );

      const error = (await get('/api/health').catch((e: unknown) => e)) as ApiError;

      expect(error).toBeInstanceOf(ApiError);
      expect(error.name).toBe('ApiError');
      expect(error.message).toBe('contract not found');
      expect(error.status).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.details).toEqual({ chainId: 1, address: '0xabc' });
    });

    it('falls back to HTTP <status> when the body carries no message', async () => {
      fetchMock.mockResolvedValue(mockResponse({}, false, 500));

      const error = (await get('/api/health').catch((e: unknown) => e)) as ApiError;

      expect(error).toBeInstanceOf(ApiError);
      expect(error.message).toBe('HTTP 500');
      expect(error.status).toBe(500);
      expect(error.code).toBeUndefined();
      expect(error.details).toBeUndefined();
    });

    it('falls back to the body.error field when no message is present', async () => {
      // Quick-range 400s (e.g. catchup without history) carry the reason in
      // `error` only; it must surface verbatim instead of a bare 'HTTP 400'.
      fetchMock.mockResolvedValue(
        mockResponse({ error: 'No previous range found. Cannot catch up.' }, false, 400),
      );

      const error = (await get('/api/health').catch((e: unknown) => e)) as ApiError;

      expect(error).toBeInstanceOf(ApiError);
      expect(error.message).toBe('No previous range found. Cannot catch up.');
      expect(error.status).toBe(400);
      expect(error.code).toBeUndefined();
      expect(error.details).toBeUndefined();
    });

    it('prefers body.message over body.error when both are present', async () => {
      // Route wrappers pair a generic `error` with a specific `message`; the
      // specific one wins (e.g. First Blocks under unknown creation).
      fetchMock.mockResolvedValue(
        mockResponse(
          {
            error: 'Failed to create range with mode: first',
            message: 'Contract creation block unknown — enter a start block manually',
          },
          false,
          400,
        ),
      );

      const error = (await get('/api/health').catch((e: unknown) => e)) as ApiError;

      expect(error).toBeInstanceOf(ApiError);
      expect(error.message).toBe(
        'Contract creation block unknown — enter a start block manually',
      );
      expect(error.status).toBe(400);
    });

    it('falls back to HTTP <status> for an unparseable error body', async () => {
      // e.g. an HTML error page from a proxy: the JSON reader degrades to
      // undefined instead of masking the status error.
      const response = mockResponse('ignored', false, 502);
      response.text = vi.fn().mockResolvedValue('<html>oops</html>');
      fetchMock.mockResolvedValue(response);

      const error = (await get('/api/health').catch((e: unknown) => e)) as ApiError;

      expect(error).toBeInstanceOf(ApiError);
      expect(error.message).toBe('HTTP 502');
      expect(error.status).toBe(502);
    });

    it('maps network failures to ApiError with status 0', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const error = (await get('/api/health').catch((e: unknown) => e)) as ApiError;

      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(0);
      expect(error.message).toContain('network error');
    });

    it('maps the per-attempt timeout to ApiError 408 "Request timeout"', async () => {
      // AbortSignal.timeout uses internal timers fake timers cannot
      // intercept: swap it for a controlled controller so the budget can
      // elapse on demand. The library discriminates timeout aborts by the
      // DOMException name 'TimeoutError'.
      const attempt = new AbortController();
      const timeoutSpy = vi
        .spyOn(AbortSignal, 'timeout')
        .mockImplementation(() => attempt.signal);
      fetchMock.mockImplementation(hangingFetch());

      const outcome = get('/api/health').catch((e: unknown) => e);
      attempt.abort(new DOMException('Signal timed out.', 'TimeoutError'));
      const error = (await outcome) as ApiError;

      expect(error).toBeInstanceOf(ApiError);
      expect(error.message).toBe('Request timeout');
      expect(error.status).toBe(408);
      expect(timeoutSpy).toHaveBeenCalledWith(10_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps user aborts as AbortError, not a timeout ApiError', async () => {
      vi.useFakeTimers();
      vi.spyOn(AbortSignal, 'timeout');
      fetchMock.mockImplementation(hangingFetch());
      const controller = new AbortController();

      const outcome = get(
        '/api/health',
        undefined,
        withSignal(api, controller.signal),
      ).catch((e: unknown) => e);
      controller.abort(
        new DOMException('The user aborted a request.', 'AbortError'),
      );

      const error = (await outcome) as DOMException;

      expect(error.name).toBe('AbortError');
      expect(error).not.toBeInstanceOf(ApiError);
    });
  });
});
