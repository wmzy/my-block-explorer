// Manual-base fallback honesty contract:
//
//  - when a stored manual base fails its startup probe and the localhost
//    scan takes over, the hook must SAY so: switchedFromManual exposes
//    {configured, using} while the stored choice itself is never erased;
//  - an alive manual base, no stored base, or a scan that finds nothing
//    keeps switchedFromManual null (no misleading banner);
//  - an explicit manual connect (setApiUrl) supersedes the fallback, and
//    the reconnect fall-through surfaces the switch like startup does;
//  - DiscoveryGate renders a dismissible banner only while connected on
//    the fallback; dismissal is session-scoped per configured→using pair.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ComponentProps } from 'react';
import { useAutoDiscovery } from '@/hooks/useAutoDiscovery';
import { DiscoveryGate } from '@/components/ServiceSetup/DiscoveryGate';
import { getApiBase, setApiBase, getStoredManualBase } from '@/util/apiBase';

const PORT_URLS = [8201, 8202, 8203, 8204, 8205].map(
  port => `http://localhost:${port}/api/health`,
);
const MANUAL_BASE = 'http://192.168.1.50:9000';
const MANUAL_URL = `${MANUAL_BASE}/api/health`;
const DEGRADED_BANNER_TEXT =
  'Backend not found — indexed data (contracts, events, search suggestions) unavailable.';

type PendingProbe = {
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
};

const inFlight = new Map<string, PendingProbe>();

// fetch double mimicking probeHealth's needs: requests stay pending until
// the test settles them; aborting rejects with a browser-like DOMException.
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

function okHealth(): Response {
  return new Response(JSON.stringify({ status: 'ok', version: 'test-version' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function respond(url: string, response: Response = okHealth()) {
  const probe = inFlight.get(url);
  inFlight.delete(url);
  probe?.resolve(response);
}

// Settle the startup sequence for "dead manual base → scan finds `port`".
async function settleFallbackScan(port: number) {
  // Manual probe burns its patient 5s budget, then the scan starts.
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  respond(PORT_URLS[port - 8201]);
  await act(async () => {
    vi.advanceTimersByTime(1500); // remaining scan probes time out
  });
}

describe('useAutoDiscovery manual-base fallback', () => {
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

  it('exposes switchedFromManual when a dead stored base degrades to a scanned base', async () => {
    localStorage.setItem('my-block-explorer-api-url', MANUAL_BASE);
    const { result } = renderHook(() => useAutoDiscovery());
    await act(async () => {});

    await settleFallbackScan(8204);

    expect(result.current.status).toBe('found');
    expect(result.current.switchedFromManual).toEqual({
      configured: MANUAL_BASE,
      using: 'http://localhost:8204',
    });
    // The runtime base is the scanned one…
    expect(getApiBase()).toBe('http://localhost:8204');
    // …but the stored choice survives untouched.
    expect(getStoredManualBase()).toBe(MANUAL_BASE);
  });

  it('keeps switchedFromManual null while the stored base is alive', async () => {
    localStorage.setItem('my-block-explorer-api-url', MANUAL_BASE);
    const { result } = renderHook(() => useAutoDiscovery());
    await act(async () => {});

    respond(MANUAL_URL);
    await act(async () => {});

    expect(result.current.status).toBe('found');
    expect(result.current.switchedFromManual).toBeNull();
    expect(getApiBase()).toBe(MANUAL_BASE);
  });

  it('keeps switchedFromManual null when no manual base is stored', async () => {
    const { result } = renderHook(() => useAutoDiscovery());
    await act(async () => {});

    respond(PORT_URLS[0]);
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(result.current.status).toBe('found');
    expect(result.current.switchedFromManual).toBeNull();
  });

  it('keeps switchedFromManual null when the scan finds nothing after a dead stored base', async () => {
    localStorage.setItem('my-block-explorer-api-url', MANUAL_BASE);
    const { result } = renderHook(() => useAutoDiscovery());
    await act(async () => {});

    // Manual probe burns 5s, then the scan starts and also times out —
    // two separate flushes: the scan timers only register after the
    // manual probe's rejection settles.
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(result.current.status).toBe('not-found');
    expect(result.current.switchedFromManual).toBeNull();
    expect(getStoredManualBase()).toBe(MANUAL_BASE);
  });

  it('treats a stored base matching the scanned origin (trailing slash) as no switch', async () => {
    // Same backend, differently spelled: the manual probe of the slashed
    // variant fails, the scan's canonical URL answers. Not a switch.
    localStorage.setItem('my-block-explorer-api-url', 'http://localhost:8201/');
    const { result } = renderHook(() => useAutoDiscovery());
    await act(async () => {});

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    respond(PORT_URLS[0]);
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(result.current.status).toBe('found');
    expect(result.current.switchedFromManual).toBeNull();
    expect(getApiBase()).toBe('http://localhost:8201');
  });

  it('clears switchedFromManual once an explicit manual connect succeeds', async () => {
    localStorage.setItem('my-block-explorer-api-url', MANUAL_BASE);
    const { result } = renderHook(() => useAutoDiscovery());
    await act(async () => {});
    await settleFallbackScan(8204);
    expect(result.current.switchedFromManual).not.toBeNull();

    const NEW_BASE = 'http://192.168.1.99:9100';
    await act(async () => {
      const connected = result.current.setApiUrl(NEW_BASE);
      respond(`${NEW_BASE}/api/health`);
      await expect(connected).resolves.toBe(true);
    });

    expect(result.current.switchedFromManual).toBeNull();
    expect(getApiBase()).toBe(NEW_BASE);
  });

  it('surfaces the switch on the reconnect fall-through too', async () => {
    localStorage.setItem('my-block-explorer-api-url', MANUAL_BASE);
    const { result } = renderHook(() => useAutoDiscovery());
    await act(async () => {});
    respond(MANUAL_URL);
    await act(async () => {});
    expect(result.current.switchedFromManual).toBeNull();

    act(() => result.current.disconnect());
    let reconnecting: Promise<unknown> | null = null;
    act(() => {
      reconnecting = result.current.reconnect();
    });
    // Manual base is dead on reconnect: fail fast (network-level reject).
    const probe = inFlight.get(MANUAL_URL);
    inFlight.delete(MANUAL_URL);
    probe?.reject(new TypeError('Failed to fetch'));
    await act(async () => {});

    respond(PORT_URLS[1]);
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await act(async () => {
      await reconnecting;
    });

    expect(result.current.status).toBe('found');
    expect(result.current.switchedFromManual).toEqual({
      configured: MANUAL_BASE,
      using: 'http://localhost:8202',
    });
  });
});

type GateProps = ComponentProps<typeof DiscoveryGate>;

function renderGate(overrides: Partial<GateProps> = {}) {
  const props: GateProps = {
    status: 'found',
    error: null,
    isScanning: false,
    setApiUrl: vi.fn().mockResolvedValue(true),
    discover: vi.fn(),
    children: <div data-testid="app-content">app</div>,
    ...overrides,
  };
  return render(<DiscoveryGate {...props} />);
}

function switchedBanner() {
  return screen.getByText(/Configured backend .* is unreachable/);
}

describe('DiscoveryGate switched-backend banner', () => {
  it('shows the banner while connected on a fallback base, not the degraded one', () => {
    renderGate({
      switchedFromManual: { configured: MANUAL_BASE, using: 'http://localhost:8204' },
    });

    const banner = switchedBanner();
    expect(banner.textContent).toContain(MANUAL_BASE);
    expect(banner.textContent).toContain('http://localhost:8204');
    expect(banner.textContent).toContain(
      'Indexed data (contracts, events) may differ between backends.',
    );
    // Connected: the degraded-mode banner has no business here.
    expect(screen.queryByText(DEGRADED_BANNER_TEXT)).toBeNull();
    expect(screen.getByTestId('app-content')).toBeInTheDocument();
  });

  it('renders no banner without switchedFromManual (unchanged behavior)', () => {
    renderGate();

    expect(screen.queryByText(/Configured backend/)).toBeNull();
    expect(screen.queryByText(DEGRADED_BANNER_TEXT)).toBeNull();
    expect(screen.getByTestId('app-content')).toBeInTheDocument();
  });

  it('hides the banner once dismissed — for the rest of the session', () => {
    const view = renderGate({
      switchedFromManual: { configured: MANUAL_BASE, using: 'http://localhost:8204' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Configured backend/)).toBeNull();

    // Same situation re-detected (fresh object identity, same values):
    // still dismissed for this session.
    view.rerender(
      <DiscoveryGate
        {...{
          status: 'found',
          error: null,
          isScanning: false,
          setApiUrl: vi.fn().mockResolvedValue(true),
          discover: vi.fn(),
        }}
        switchedFromManual={{
          configured: MANUAL_BASE,
          using: 'http://localhost:8204',
        }}
      >
        <div data-testid="app-content">app</div>
      </DiscoveryGate>,
    );
    expect(screen.queryByText(/Configured backend/)).toBeNull();
  });

  it('re-warns when the fallback pair actually changes', () => {
    const view = renderGate({
      switchedFromManual: { configured: MANUAL_BASE, using: 'http://localhost:8204' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    // A different scanned base is a genuinely new situation.
    view.rerender(
      <DiscoveryGate
        {...{
          status: 'found',
          error: null,
          isScanning: false,
          setApiUrl: vi.fn().mockResolvedValue(true),
          discover: vi.fn(),
        }}
        switchedFromManual={{
          configured: MANUAL_BASE,
          using: 'http://localhost:8202',
        }}
      >
        <div data-testid="app-content">app</div>
      </DiscoveryGate>,
    );
    expect(switchedBanner().textContent).toContain('http://localhost:8202');
  });

  it('hides the switched banner while disconnected — the degraded banner tells that story', () => {
    renderGate({
      status: 'not-found',
      switchedFromManual: { configured: MANUAL_BASE, using: 'http://localhost:8204' },
    });

    expect(screen.queryByText(/Configured backend/)).toBeNull();
    expect(screen.getByText(DEGRADED_BANNER_TEXT)).toBeInTheDocument();
  });
});
