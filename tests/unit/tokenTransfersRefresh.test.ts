// The token-transfers refresh bypass was a MODULE-level one-shot latch:
// requestTokenTransfersRefresh() set a global flag, and the NEXT
// fetchTokenTransfers call — for ANY address, any page, any window,
// triggered by anything — consumed it and sent ?refresh=1.
//
// The latch exists because a refresh is per-REQUEST semantics and cannot
// ride the hook's cache-identity arguments: a boolean in the args would
// either stick (re-scanning on every page turn) or reset (flashing the
// stale pre-refresh entry back in). But module-global state has a wider
// blast radius than the user action that armed it: a user's explicit
// Retry could be consumed by a concurrent, unrelated fetch, so the Retry
// silently served the stale cached scan while some other request paid
// for the backend re-scan.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('@/util/http', () => ({
  get: mockGet,
  longRunningApi: {},
  withSignal: (_api: unknown, signal: AbortSignal | undefined) => signal,
}));

const ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ transfers: [], coverage: 'partial' });
});

describe('token-transfers refresh is scoped to its own request', () => {
  it('sends refresh=1 on the request the user asked to refresh', async () => {
    const { fetchTokenTransfers, requestTokenTransfersRefresh } = await import(
      '@/services/tokenTransfers',
    );

    requestTokenTransfersRefresh(1, ADDRESS);
    await fetchTokenTransfers(1, ADDRESS, '0', 25);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet.mock.calls[0][1]).toMatchObject({ refresh: '1' });
  });

  it('does not let an unrelated fetch consume another request\'s refresh', async () => {
    const { fetchTokenTransfers, requestTokenTransfersRefresh } = await import(
      '@/services/tokenTransfers',
    );

    requestTokenTransfersRefresh(1, ADDRESS);
    // Something ELSE fetches first — a different address, a different
    // page, a background re-render. The user's armed refresh must not be
    // spent here.
    await fetchTokenTransfers(1, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '0', 25);
    expect(mockGet.mock.calls[0][1]).not.toMatchObject({ refresh: '1' });

    // The request the user actually asked to refresh still refreshes.
    await fetchTokenTransfers(1, ADDRESS, '0', 25);
    expect(mockGet.mock.calls[1][1]).toMatchObject({ refresh: '1' });
  });

  it('scopes the latch to the widened window "Search deeper" is about to request', async () => {
    const { fetchTokenTransfers, requestTokenTransfersRefresh } = await import(
      '@/services/tokenTransfers',
    );

    // Search deeper arms for the WINDOW it is about to set, not the
    // current one — the current window's request must not spend it.
    requestTokenTransfersRefresh(1, ADDRESS, 4000);
    await fetchTokenTransfers(1, ADDRESS, '0', 25, 1000);
    expect(mockGet.mock.calls[0][1]).not.toMatchObject({ refresh: '1' });

    await fetchTokenTransfers(1, ADDRESS, '0', 25, 4000);
    expect(mockGet.mock.calls[1][1]).toMatchObject({ refresh: '1' });
  });

  it('scopes the latch to the scan mode, so a mode switch cannot spend it', async () => {
    const { fetchTokenTransfers, requestTokenTransfersRefresh } = await import(
      '@/services/tokenTransfers',
    );

    requestTokenTransfersRefresh(1, ADDRESS, undefined, 'token');
    await fetchTokenTransfers(1, ADDRESS, '0', 25, undefined, 'participant');
    expect(mockGet.mock.calls[0][1]).not.toMatchObject({ refresh: '1' });

    await fetchTokenTransfers(1, ADDRESS, '0', 25, undefined, 'token');
    expect(mockGet.mock.calls[1][1]).toMatchObject({ refresh: '1' });
  });

  it('consumes the latch once — a later ordinary fetch of the same request is not a refresh', async () => {
    const { fetchTokenTransfers, requestTokenTransfersRefresh } = await import(
      '@/services/tokenTransfers',
    );

    requestTokenTransfersRefresh(1, ADDRESS);
    await fetchTokenTransfers(1, ADDRESS, '0', 25);
    await fetchTokenTransfers(1, ADDRESS, '0', 25);

    expect(mockGet.mock.calls[0][1]).toMatchObject({ refresh: '1' });
    expect(mockGet.mock.calls[1][1]).not.toMatchObject({ refresh: '1' });
  });

  it('sends no refresh on ordinary fetches', async () => {
    const { fetchTokenTransfers } = await import('@/services/tokenTransfers');

    await fetchTokenTransfers(1, ADDRESS, '0', 25);
    await fetchTokenTransfers(1, ADDRESS, '25', 25);

    for (const call of mockGet.mock.calls) {
      expect(call[1]).not.toMatchObject({ refresh: '1' });
    }
  });
});
