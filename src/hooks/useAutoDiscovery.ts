import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { setApiBase, getStoredManualBase, storeManualBase } from '@/util/apiBase';

export const DEFAULT_PORTS = [8201, 8202, 8203, 8204, 8205] as const;
const DEFAULT_HOST = 'localhost';
// Per-probe budget for the port scan. All candidates are probed in
// parallel, so this is also the whole-scan worst case (~1.5s instead of
// the old serial ports × 3s ≈ 15s).
const PROBE_TIMEOUT_MS = 1500;
// Probing an explicit user choice (a saved or freshly entered manual
// base) gets more patience than a scan probe before declaring it dead.
const MANUAL_URL_TIMEOUT_MS = 5000;

// Probe a candidate base URL for a live backend. The probes never go
// through the global base (util/http always prefixes getApiBase()), so this
// stays a direct fetch with the probe's own timeout. Same error contract
// as before: throws on failure, callers decide whether that means "port
// closed" or "invalid URL".
async function probeHealth(url: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${url}/api/health`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const health = await response.json();
    if (typeof health !== 'object' || health === null) {
      throw new Error('Invalid health response');
    }
    return health as Record<string, unknown>;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timeout', { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Probe one port. Expected probe failures (refused connection, timeout,
// non-JSON or unhealthy response) map to null so the parallel scan can
// use Promise.all directly; only a genuinely unexpected error rejects,
// which surfaces as a discovery error instead of reading as "port
// closed".
async function probePort(
  port: number,
  host = DEFAULT_HOST,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<ServiceInfo | null> {
  const url = `http://${host}:${port}`;
  const startTime = Date.now();
  let health: Record<string, unknown>;
  try {
    health = await probeHealth(url, timeoutMs);
  } catch {
    // Port unavailable or service not responding
    return null;
  }

  if (!health?.status) return null;

  return {
    host,
    port,
    url,
    version: health.version as string | undefined,
    latency: Date.now() - startTime,
  };
}

function serviceInfoFromUrl(url: string, health: Record<string, unknown>): ServiceInfo {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port, 10) || (parsed.protocol === 'https:' ? 443 : 80),
    url,
    version: health.version as string | undefined,
  };
}

export type DiscoveryStatus =
  | 'idle' // Not started
  | 'discovering' // Scanning in progress
  | 'found' // Service found
  | 'not-found' // No service found
  | 'error'; // Discovery error

export type ServiceInfo = {
  host: string;
  port: number;
  url: string;
  version?: string;
  latency?: number;
};

// Set when a stored manual base failed its probe and the localhost scan
// took over for this session: the runtime base differs from the stored
// choice, so indexed data (contracts, events) may come from a different
// backend than the user configured. Null while the manual base is alive,
// absent, or nothing was found at all.
export type ManualBaseFallback = {
  /** The stored manual base whose health probe failed. */
  configured: string;
  /** The scanned base actually serving this session. */
  using: string;
};

// Origin-level comparison so cosmetic differences (trailing slash,
// default port) do not read as "switched backends". Unparseable values
// compare as different — the honest reading for a configured base that
// could not even be probed.
function sameBackendOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export function useAutoDiscovery() {
  const [status, setStatus] = useState<DiscoveryStatus>('idle');
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [switchedFromManual, setSwitchedFromManual] = useState<ManualBaseFallback | null>(null);

  // Discovery-attempt generation. Every async path (the port scan, the
  // stored-base probe, setApiUrl, disconnect) bumps this counter, and a
  // path that resumes after an await checks it before writing any state
  // or calling setApiBase. Without it a SLOW earlier attempt lands on
  // top of a NEWER explicit one: the user points the app at a backend
  // while the startup scan is still probing, and the late scan then
  // re-points the whole app at a port they never chose (or reconnects a
  // backend they just disconnected). The user's action must win.
  const attemptRef = useRef(0);
  // Bump and return the new generation. A ref (not state) so starting an
  // attempt never re-renders — the calls are made from handlers and
  // effects, not during render.
  const beginAttempt = useCallback((): number => {
    attemptRef.current += 1;
    return attemptRef.current;
  }, []);

  // Derived: true when connected to a service
  const isConnected = useMemo(() => status === 'found', [status]);

  // Scan port range. Every candidate is probed concurrently: the worst
  // case is one probe timeout instead of ports × timeout, and expected
  // probe failures are mapped to null inside probePort, so Promise.all
  // keeps the port order — the first (lowest) healthy port wins, matching
  // the old serial scan's preference.
  const discover = useCallback(
    async (
      ports: readonly number[] = DEFAULT_PORTS,
      host = DEFAULT_HOST,
    ): Promise<ServiceInfo | null> => {
      const attempt = beginAttempt();
      setStatus('discovering');
      setError(null);
      setIsScanning(true);
      setServiceInfo(null);

      try {
        const services = await Promise.all(ports.map(port => probePort(port, host)));
        // Superseded by a newer action (explicit URL, disconnect, a newer
        // reconnect): discard the result instead of overwriting it.
        if (attempt !== attemptRef.current) return null;
        const service = services.find(candidate => candidate !== null) ?? null;

        if (service) {
          setServiceInfo(service);
          setStatus('found');
          setApiBase(service.url);
          return service;
        }

        setStatus('not-found');
        return null;
      } catch (err) {
        if (attempt !== attemptRef.current) return null;
        setError(err instanceof Error ? err.message : 'Discovery failed');
        setStatus('error');
        return null;
      } finally {
        // Only the newest attempt owns the scanning flag: a superseded
        // one clearing it would hide a scan that is still running.
        if (attempt === attemptRef.current) setIsScanning(false);
      }
    },
    [beginAttempt],
  );

  // Auto-discover on page load. The stored manual base is an explicit
  // choice, so it is probed first and wins while alive (see apiBase.ts
  // precedence contract). A dead one degrades to the scan for THIS
  // session only — the stored choice is kept so a temporarily slow
  // remote backend is not permanently erased; removing an entry stays an
  // explicit user action. When the scan then lands on a different
  // backend, that switch is surfaced via switchedFromManual instead of
  // passing silently.
  const autoDiscover = useCallback(async (): Promise<ServiceInfo | null> => {
    const attempt = beginAttempt();
    const savedUrl = getStoredManualBase();
    if (savedUrl) {
      try {
        const health = await probeHealth(savedUrl, MANUAL_URL_TIMEOUT_MS);

        // Superseded while the stored-base probe was in flight.
        if (attempt !== attemptRef.current) return null;
        if (health?.status) {
          const info = serviceInfoFromUrl(savedUrl, health);
          setServiceInfo(info);
          setStatus('found');
          setApiBase(savedUrl);
          setSwitchedFromManual(null);
          return info;
        }
      } catch {
        // Saved URL unreachable right now: fall through to the scan
        // without erasing the stored choice.
      }
    }

    // discover() opens its OWN attempt, which supersedes this one from
    // here on — that is what lets an explicit action in between win.
    const service = await discover();
    if (savedUrl && service && !sameBackendOrigin(service.url, savedUrl)) {
      setSwitchedFromManual({ configured: savedUrl, using: service.url });
    }
    return service;
  }, [discover, beginAttempt]);

  // Manually set API URL (setup panel). Persists the choice so it takes
  // precedence over scans on the next startup too.
  const setApiUrl = useCallback(
    async (url: string): Promise<boolean> => {
      // An explicit choice opens a new generation: any scan still probing
      // is now stale and must not re-point the app when it lands.
      const attempt = beginAttempt();
      try {
        const health = await probeHealth(url, MANUAL_URL_TIMEOUT_MS);

        if (attempt !== attemptRef.current) return false;
        if (health?.status) {
          setServiceInfo(serviceInfoFromUrl(url, health));
          setStatus('found');
          setError(null);
          // An explicit fresh choice supersedes any earlier silent
          // fallback — the banner would be stale.
          setSwitchedFromManual(null);

          storeManualBase(url);
          setApiBase(url);

          return true;
        }

        return false;
      } catch (err) {
        if (attempt !== attemptRef.current) return false;
        setError(err instanceof Error ? err.message : 'Invalid API URL');
        return false;
      }
    },
    [beginAttempt],
  );

  // Disconnect from current service (preserves saved URL for reconnect)
  const disconnect = useCallback(() => {
    // Opens a new generation: a scan or reconnect still in flight is now
    // stale, so it cannot reconnect the backend the user just turned off.
    beginAttempt();
    setApiBase('');
    setServiceInfo(null);
    setError(null);
    setIsScanning(false);
    setStatus('not-found');
    // Intentionally keep the stored manual base for reconnect
  }, [beginAttempt]);

  // Reconnect: try saved URL first, fallback to port scan
  const reconnect = useCallback(async (): Promise<ServiceInfo | null> => {
    const attempt = beginAttempt();
    const savedUrl = getStoredManualBase();

    if (savedUrl) {
      setStatus('discovering');
      setIsScanning(true);
      setError(null);

      try {
        const health = await probeHealth(savedUrl, MANUAL_URL_TIMEOUT_MS);

        // Superseded while the stored-base probe was in flight.
        if (attempt !== attemptRef.current) return null;
        if (health?.status) {
          const info = serviceInfoFromUrl(savedUrl, health);
          setServiceInfo(info);
          setStatus('found');
          setIsScanning(false);
          setApiBase(savedUrl);
          setSwitchedFromManual(null);
          return info;
        }
      } catch {
        // Saved URL no longer valid, fall through to full scan
      }
    }

    // Fallback to port scanning; same silent-switch surfacing as the
    // startup path above. discover() opens its own attempt.
    const service = await discover();
    if (savedUrl && service && !sameBackendOrigin(service.url, savedUrl)) {
      setSwitchedFromManual({ configured: savedUrl, using: service.url });
    }
    return service;
  }, [discover, beginAttempt]);

  // Auto-discover on mount
  useEffect(() => {
    autoDiscover();
  }, [autoDiscover]);

  return {
    status,
    serviceInfo,
    error,
    isScanning,
    isConnected,
    // Truthy only while the session runs on a scanned base after the
    // stored manual one failed its probe (see ManualBaseFallback).
    switchedFromManual,
    discover,
    autoDiscover,
    setApiUrl,
    disconnect,
    reconnect,
  };
}
