// useAutoDiscovery timing and precedence contract:
//
//  - the localhost port scan probes 8201–8205 IN PARALLEL (all five
//    requests in flight at once) with a ~1.5s per-probe budget that is
//    also the whole-scan worst case — not the old serial ports × 3s;
//  - the lowest healthy port wins even when a higher port answers first
//    (same preference as the old serial scan);
//  - an explicitly stored manual base is probed first and wins while
//    alive; a dead one degrades to the parallel scan for that session
//    only — the stored choice is kept (erasing it stays an explicit user
//    action), so a temporarily slow remote backend survives a reload;
//  - setApiUrl connects mid-session and persists the manual base.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoDiscovery } from '@/hooks/useAutoDiscovery';
import { getApiBase, setApiBase, getStoredManualBase } from '@/util/apiBase';

const PORT_URLS = [8201, 8202, 8203, 8204, 8205].map(port => `http://localhost:${port}/api/health`);
const MANUAL_BASE = 'http://192.168.1.50:9000';
const MANUAL_URL = `${MANUAL_BASE}/api/health`;

type PendingProbe = {
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
};

const inFlight = new Map<string, PendingProbe>();

// fetch double that mimics the real one closely enough for probeHealth:
// requests stay pending until the test settles them, and aborting the
// probe's AbortSignal rejects with a DOMException like a browser would.
function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      return new Promise<Response>((resolve, reject) => {
        inFlight.set(url, { resolve, reject });
        init?.signal?.addEventListener('abort', () => {
          if (inFlight.get(url)) {
            inFlight.delete(url);
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          }
        });
      });
    }),
  );
}

function okHealth(version = 'test-version'): Response {
  return new Response(JSON.stringify({ status: 'ok', version }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function respond(url: string, response: Response = okHealth()) {
  const probe = inFlight.get(url);
  inFlight.delete(url);
  probe?.resolve(response);
}

const inFlightUrls = () => Array.from(inFlight.keys());

describe('useAutoDiscovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFetch();
    localStorage.clear();
    setApiBase('');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('probes all five ports in parallel within a single 1.5s budget', async () => {
    const { result } = renderHook(() => useAutoDiscovery());
    await act(async () => {});

    // All five probes are in flight simultaneously — the old serial scan
    // would have issued exactly one.
    expect(inFlightUrls()).toEqual(PORT_URLS);
    expect(result.current.status).toBe('discovering');

    // Still scanning right before the budget expires…
    await act(async () => {
      vi.advanceTimersByTime(1499);
    });
    expect(result.current.status).toBe('discovering');
    expect(inFlight.size).toBe(5);

    // …and declared not-found at the 1.5s mark (not 5 × 3s).
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.status).toBe('not-found');
    expect(result.current.isScanning).toBe(false);
    expect(result.current.serviceInfo).toBeNull();
    expect(getApiBase()).toBe('');
  });

  it('picks the lowest healthy port even when a higher one answers first', async () => {
    const { result } = renderHook(() => useAutoDiscovery());
    await act(async () => {});

    respond(PORT_URLS[2]); // 8203 answers first
    await act(async () => {});
    expect(result.current.status).toBe('discovering'); // still waiting

    respond(PORT_URLS[0]); // 8201 answers later
    await act(async () => {
      vi.advanceTimersByTime(1500); // 8202/8204/8205 time out
    });

    expect(result.current.status).toBe('found');
    expect(result.current.serviceInfo?.port).toBe(8201);
    expect(getApiBase()).toBe('http://localhost:8201');
  });

  it('probes a stored manual base first and never port-scans when it is alive', async () => {
    localStorage.setItem('my-block-explorer-api-url', MANUAL_BASE);
    const { result } = renderHook(() => useAutoDiscovery());
    await act(async () => {});

    // Only the manual base was probed — precedence over auto-discovery.
    expect(inFlightUrls()).toEqual([MANUAL_URL]);

    respond(MANUAL_URL);
    await act(async () => {});

    expect(result.current.status).toBe('found');
    expect(result.current.serviceInfo?.url).toBe(MANUAL_BASE);
    expect(result.current.serviceInfo?.port).toBe(9000);
    expect(getApiBase()).toBe(MANUAL_BASE);
  });

  it('keeps a dead stored manual base stored while degrading to the scan', async () => {
    localStorage.setItem('my-block-explorer-api-url', MANUAL_BASE);
    const { result } = renderHook(() => useAutoDiscovery());
    await act(async () => {});

    // The saved base keeps its patient 5s budget…
    await act(async () => {
      vi.advanceTimersByTime(4999);
    });
    expect(inFlightUrls()).toEqual([MANUAL_URL]);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    // …then the session degrades to the localhost scan…
    expect(inFlightUrls()).toEqual(PORT_URLS);
    // …but the stored choice survives: removal stays an explicit user
    // action, so one slow link does not erase a remote backend forever.
    expect(getStoredManualBase()).toBe(MANUAL_BASE);

    respond(PORT_URLS[3]); // 8204
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(result.current.status).toBe('found');
    expect(result.current.serviceInfo?.port).toBe(8204);
    expect(getApiBase()).toBe('http://localhost:8204');
    // Still stored after a successful fallback: the scan wins this
    // session's runtime slot without overwriting the saved choice.
    expect(getStoredManualBase()).toBe(MANUAL_BASE);
  });

  it('degrades to the scan immediately when the stored base errors (not times out)', async () => {
    localStorage.setItem('my-block-explorer-api-url', MANUAL_BASE);
    const { result } = renderHook(() => useAutoDiscovery());
    await act(async () => {});

    // A network-level rejection (e.g. unreachable host) fails fast —
    // no 5s budget is burned before the fallback scan.
    const probe = inFlight.get(MANUAL_URL);
    inFlight.delete(MANUAL_URL);
    probe?.reject(new TypeError('Failed to fetch'));
    await act(async () => {});

    expect(inFlightUrls()).toEqual(PORT_URLS);
    // The stored choice is kept on this failure path too.
    expect(getStoredManualBase()).toBe(MANUAL_BASE);

    respond(PORT_URLS[0]);
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.status).toBe('found');
    expect(getApiBase()).toBe('http://localhost:8201');
  });

  // A scan/reconnect is an ASYNC probe that takes up to 1.5s. If the
  // user points the app at a backend in the meantime, the late scan
  // result used to overwrite the user's choice: status flipped back and
  // setApiBase() re-pointed the whole app at a port the user did not
  // pick. A slow localhost scan must never outrank an explicit choice.
  it('does not let a late scan overwrite a newer explicit setApiUrl', async () => {
    const { result } = renderHook(() => useAutoDiscovery());
    await act(async () => {});
    // The startup scan is still probing.
    expect(inFlightUrls()).toEqual(PORT_URLS);

    // The user picks a backend by hand before the scan finishes.
    await act(async () => {
      const connected = result.current.setApiUrl(MANUAL_BASE);
      respond(MANUAL_URL);
      await expect(connected).resolves.toBe(true);
    });
    expect(getApiBase()).toBe(MANUAL_BASE);

    // The stale scan now answers 8201 and lands late.
    respond(PORT_URLS[0]);
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    // The explicit choice still stands.
    expect(getApiBase()).toBe(MANUAL_BASE);
    expect(result.current.serviceInfo?.url).toBe(MANUAL_BASE);
    expect(result.current.status).toBe('found');
  });

  it('does not let a late scan overwrite a disconnect', async () => {
    const { result } = renderHook(() => useAutoDiscovery());
    await act(async () => {});

    // The user disconnects mid-scan (the "backend not found" path).
    act(() => {
      result.current.disconnect();
    });
    expect(getApiBase()).toBe('');

    respond(PORT_URLS[0]);
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    // A backend the user explicitly turned off must stay off.
    expect(getApiBase()).toBe('');
    expect(result.current.status).toBe('not-found');
  });

  it('setApiUrl connects mid-session and persists the manual base', async () => {
    const { result } = renderHook(() => useAutoDiscovery());
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(1500); // initial scan finds nothing
    });
    expect(result.current.status).toBe('not-found');

    await act(async () => {
      const connected = result.current.setApiUrl('http://localhost:8201');
      respond(PORT_URLS[0]);
      await expect(connected).resolves.toBe(true);
    });

    expect(result.current.status).toBe('found');
    expect(result.current.isConnected).toBe(true);
    expect(getApiBase()).toBe('http://localhost:8201');
    expect(getStoredManualBase()).toBe('http://localhost:8201');
  });
});
