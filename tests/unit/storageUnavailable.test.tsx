// Browser storage that is UNAVAILABLE — an opaque/sandboxed origin,
// storage blocked by policy, a private window with dom.storage disabled —
// throws from getItem/setItem, and a thrown localStorage access on a boot
// or render path takes the whole app down with it. Every other storage
// site in src already guards this exact state (themePreference, units,
// adminAuth, watchlist, searchHistory, chainReset, nftMetadata, the custom
// ABI panel, backupRestore, the restore file reader); the three below did
// not, and each sits on a path where the throw is fatal.
//
// The class, not three anecdotes: a storage read must degrade to the
// "absent" answer and a write to "not persisted", never propagate.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoDiscovery } from '@/hooks/useAutoDiscovery';
import { getApiBase, setApiBase, getStoredManualBase, storeManualBase } from '@/util/apiBase';
import {
  readRememberedChainId,
  rememberChainId,
  getPreferredChainId,
} from '@/views/Home/Landing';

const PORT_URLS = [8201, 8202, 8203, 8204, 8205].map(port => `http://localhost:${port}/api/health`);

// A browser whose storage accessors throw — the documented private-mode /
// blocked-storage behaviour (and what jsdom-less runtimes do).
const installThrowingStorage = () => {
  const boom = (op: string) => () => {
    throw new DOMException(`The operation is insecure. (${op})`, 'SecurityError');
  };
  const storage = {
    getItem: boom('getItem'),
    setItem: boom('setItem'),
    removeItem: boom('removeItem'),
    clear: boom('clear'),
    key: boom('key'),
    length: 0,
  } as unknown as Storage;
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', storage);
};

describe('storage access that throws', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('util/apiBase', () => {
    it('reads the stored manual base as absent instead of throwing', () => {
      installThrowingStorage();
      expect(getStoredManualBase()).toBeNull();
    });

    it('swallows a failed write (the choice is simply not persisted)', () => {
      installThrowingStorage();
      expect(() => storeManualBase('http://localhost:8201')).not.toThrow();
    });
  });

  describe('views/Home/Landing remembered chain', () => {
    it('reads as "nothing remembered" instead of throwing', () => {
      installThrowingStorage();
      expect(readRememberedChainId()).toBeUndefined();
      // The deterministic default still resolves — the landing route
      // must redirect, not crash.
      expect(() => getPreferredChainId()).not.toThrow();
    });

    it('does not throw when the navigation writes the key', () => {
      installThrowingStorage();
      expect(() => rememberChainId(137)).not.toThrow();
    });
  });
});

describe('discovery hook with unusable storage', () => {
  const MANUAL_BASE = 'http://192.168.1.50:9000';
  const MANUAL_URL = `${MANUAL_BASE}/api/health`;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    setApiBase('');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('still scans for a backend instead of stalling on the scanning screen', async () => {
    // Without the guard, getStoredManualBase() throws outside autoDiscover's
    // try, the effect's un-awaited promise rejects and status never leaves
    // 'idle' — so DiscoveryGate's settled latch stays false and the app
    // hangs on a full-screen "Scanning…" forever.
    installThrowingStorage();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url !== PORT_URLS[0]) {
          return Promise.reject(new DOMException('Failed to fetch', 'TypeError'));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ status: 'ok', version: 'test' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }),
    );

    const { result } = renderHook(() => useAutoDiscovery());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(result.current.status).toBe('found');
    expect(result.current.serviceInfo?.url).toBe('http://localhost:8201');
    expect(getApiBase()).toBe('http://localhost:8201');
  });

  it('still reports a healthy manual base as valid when the persist fails', async () => {
    // The health probe already succeeded; a storage-only failure must not
    // be reported to the user as "Invalid API URL".
    installThrowingStorage();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (String(input) === MANUAL_URL) {
          return Promise.resolve(
            new Response(JSON.stringify({ status: 'ok', version: 'test' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        return Promise.reject(new DOMException('Failed to fetch', 'TypeError'));
      }),
    );

    const { result } = renderHook(() => useAutoDiscovery());
    await act(async () => {
      await Promise.resolve();
    });
    // setApiUrl is the setup-panel path with the same shape.
    let connected: boolean | undefined;
    await act(async () => {
      connected = await result.current.setApiUrl(MANUAL_BASE);
    });

    expect(connected).toBe(true);
    expect(result.current.error).toBeNull();
    expect(getApiBase()).toBe(MANUAL_BASE);
  });
});
